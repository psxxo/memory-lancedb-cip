import { appendFile, mkdir, open, readFile, rename, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
/**
 * Durable mirror of the pending-extraction queue.
 *
 * The scheduled extraction turn runs as a separate agent run, and the host may
 * re-capture the prepared plugin generation for that run. The in-memory
 * `autoCaptureDeferredFlushTurns` Map therefore is NOT guaranteed to be the same
 * module instance that the tool sees: one generation deposits the turns (and
 * logs e.g. "dispatched for 17 queued session(s)") while another generation's
 * tool call reads an empty Map and returns "Nothing queued for memory
 * extraction". This store keeps the queued turns in a JSONL file under the
 * plugin's own data directory so any generation (or a later process) drains the
 * same queue.
 *
 * Every operation is best-effort: a filesystem failure must never break capture
 * or extraction, so errors are swallowed (and reported through the injected
 * logger when present).
 */
export const PENDING_EXTRACTION_QUEUE_FILE = "pending-extraction-queue.jsonl";
export const DEFAULT_PENDING_EXTRACTION_QUEUE_MAX_ENTRIES = 2000;
export const DEFAULT_PENDING_EXTRACTION_QUEUE_MAX_BYTES = 2_000_000;
export function resolvePendingExtractionQueuePath(dataDir) {
    return join(dataDir, PENDING_EXTRACTION_QUEUE_FILE);
}
function isRecord(value) {
    if (!value || typeof value !== "object")
        return false;
    const candidate = value;
    return (typeof candidate.sessionKey === "string" &&
        candidate.sessionKey.length > 0 &&
        typeof candidate.text === "string" &&
        candidate.text.length > 0 &&
        (candidate.role === "user" || candidate.role === "assistant"));
}
function recordToTurn(record) {
    const turn = { role: record.role, text: record.text };
    if (typeof record.messageId === "number")
        turn.messageId = record.messageId;
    return turn;
}
/**
 * Best-effort fsync of a path so a just-written queue line survives a crash.
 * The queue is the extraction source of truth, so its writes are synced; a
 * failure here stays non-fatal to honor the store's best-effort contract.
 */
async function fsyncFile(path) {
    let handle;
    try {
        handle = await open(path, "r+");
        await handle.sync();
    }
    catch {
        /* best effort */
    }
    finally {
        try {
            await handle?.close();
        }
        catch {
            /* best effort */
        }
    }
}
/**
 * JSONL-backed queue of conversation turns awaiting scheduled extraction.
 *
 * Writes go through {@link PendingExtractionQueueStore.serialize} so concurrent
 * appends/removals from one generation cannot interleave a read-modify-write.
 * Cross-generation safety comes from append-only deposition (each line is a
 * complete JSON object written with a single `appendFile`) plus atomic rewrite
 * (temp file + `rename`) when the cap is enforced or consumed entries are
 * dropped.
 */
export class PendingExtractionQueueStore {
    filePath;
    maxEntries;
    maxBytes;
    onError;
    onTrim;
    chain = Promise.resolve();
    constructor(filePath, options = {}) {
        this.filePath = filePath;
        this.maxEntries = options.maxEntries && options.maxEntries > 0
            ? Math.floor(options.maxEntries)
            : DEFAULT_PENDING_EXTRACTION_QUEUE_MAX_ENTRIES;
        this.maxBytes = options.maxBytes && options.maxBytes > 0
            ? Math.floor(options.maxBytes)
            : DEFAULT_PENDING_EXTRACTION_QUEUE_MAX_BYTES;
        this.onError = options.onError;
        this.onTrim = options.onTrim;
    }
    get path() {
        return this.filePath;
    }
    report(error) {
        try {
            this.onError?.(error instanceof Error ? error.message : String(error));
        }
        catch {
            /* diagnostics must never throw */
        }
    }
    /** Serialize an async operation behind every previously queued one. */
    serialize(operation) {
        const run = this.chain.then(operation, operation);
        this.chain = run.then(() => undefined, () => undefined);
        return run;
    }
    /**
     * Append the given turns for a session. Idempotency is the caller's concern
     * (dedupe by text happens on load/drain); this only mirrors what the in-memory
     * queue holds.
     */
    async append(sessionKey, turns, now = Date.now()) {
        if (!Array.isArray(turns) || turns.length === 0)
            return;
        const records = [];
        for (const turn of turns) {
            if (!turn || typeof turn.text !== "string" || turn.text.length === 0)
                continue;
            if (turn.role !== "user" && turn.role !== "assistant")
                continue;
            const record = {
                sessionKey,
                text: turn.text,
                role: turn.role,
                timestamp: now,
            };
            if (typeof turn.messageId === "number")
                record.messageId = turn.messageId;
            records.push(record);
        }
        if (records.length === 0)
            return;
        await this.serialize(async () => {
            try {
                await mkdir(dirname(this.filePath), { recursive: true });
                const payload = records.map((record) => JSON.stringify(record)).join("\n") + "\n";
                await appendFile(this.filePath, payload, "utf8");
                await fsyncFile(this.filePath);
                await this.enforceCaps();
            }
            catch (error) {
                this.report(error);
            }
        });
    }
    /** Raw lines, newest last, skipping blanks and unparsable lines. */
    async readLines() {
        try {
            const raw = await readFile(this.filePath, "utf8");
            return raw.split("\n").filter((line) => line.trim().length > 0);
        }
        catch (error) {
            const code = error?.code;
            if (code !== "ENOENT")
                this.report(error);
            return [];
        }
    }
    async readRecords() {
        const lines = await this.readLines();
        const records = [];
        for (const line of lines) {
            try {
                const parsed = JSON.parse(line);
                if (isRecord(parsed))
                    records.push(parsed);
            }
            catch {
                /* skip a torn/unparsable line rather than failing the whole queue */
            }
        }
        return records;
    }
    /** All queued turns grouped by session key, in deposit order. */
    async load() {
        const bySession = new Map();
        for (const record of await this.readRecords()) {
            const turns = bySession.get(record.sessionKey);
            if (turns)
                turns.push(recordToTurn(record));
            else
                bySession.set(record.sessionKey, [recordToTurn(record)]);
        }
        return bySession;
    }
    /** Number of queued records and the file size in bytes. */
    async size() {
        const records = await this.readRecords();
        let bytes = 0;
        try {
            bytes = (await stat(this.filePath)).size;
        }
        catch {
            bytes = 0;
        }
        return { entries: records.length, bytes };
    }
    /**
     * Remove exactly the turns consumed by a successful extraction, keeping
     * everything else queued (restore-on-failure semantics). Returns the number of
     * records removed.
     */
    async remove(sessionKey, texts) {
        const consumed = new Set(texts);
        if (consumed.size === 0)
            return 0;
        const removed = await this.serialize(async () => {
            const lines = await this.readLines();
            const kept = [];
            let dropped = 0;
            for (const line of lines) {
                let matches = false;
                try {
                    const parsed = JSON.parse(line);
                    matches =
                        isRecord(parsed) && parsed.sessionKey === sessionKey && consumed.has(parsed.text);
                }
                catch {
                    matches = false;
                }
                if (matches)
                    dropped += 1;
                else
                    kept.push(line);
            }
            if (dropped > 0)
                await this.writeLines(kept);
            return dropped;
        });
        return removed;
    }
    async writeLines(lines) {
        await mkdir(dirname(this.filePath), { recursive: true });
        if (lines.length === 0) {
            await writeFile(this.filePath, "", "utf8");
            await fsyncFile(this.filePath);
            return;
        }
        const tempPath = `${this.filePath}.${process.pid}.tmp`;
        await writeFile(tempPath, lines.join("\n") + "\n", "utf8");
        await fsyncFile(tempPath);
        await rename(tempPath, this.filePath);
        await fsyncFile(this.filePath);
    }
    /** Bound the file by entry count and byte size, dropping the oldest records. */
    async enforceCaps() {
        const lines = await this.readLines();
        if (lines.length === 0)
            return;
        let kept = lines;
        let trimmed = false;
        if (kept.length > this.maxEntries) {
            kept = kept.slice(-this.maxEntries);
            trimmed = true;
        }
        let bytes = Buffer.byteLength(kept.join("\n") + "\n", "utf8");
        if (bytes > this.maxBytes) {
            trimmed = true;
            // Drop oldest lines until the payload fits the byte budget.
            let start = 0;
            while (start < kept.length && bytes > this.maxBytes) {
                bytes -= Buffer.byteLength(kept[start] + "\n", "utf8");
                start += 1;
            }
            kept = kept.slice(start);
        }
        if (!trimmed)
            return;
        const dropped = lines.length - kept.length;
        await this.writeLines(kept);
        try {
            this.onTrim?.({
                dropped,
                entries: kept.length,
                bytes: Buffer.byteLength(kept.join("\n") + "\n", "utf8"),
            });
        }
        catch {
            /* diagnostics must never throw */
        }
    }
}
