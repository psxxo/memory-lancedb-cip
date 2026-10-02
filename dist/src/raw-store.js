import { createHash } from "node:crypto";
import { appendFile, mkdir, open, readFile, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import * as nodeZlib from "node:zlib";
const zstd = nodeZlib;
function compressBlock(data, level) {
    const compress = zstd.zstdCompressSync;
    if (typeof compress !== "function") {
        throw new Error("node:zlib does not expose zstdCompressSync (Node 22.15+ required)");
    }
    return level === undefined ? compress(data) : compress(data, { level });
}
function decompressBlock(data) {
    const decompress = zstd.zstdDecompressSync;
    if (typeof decompress !== "function") {
        throw new Error("node:zlib does not expose zstdDecompressSync (Node 22.15+ required)");
    }
    return decompress(data);
}
/**
 * Raw tier of the two-tier memory store (see RAW-FIRST-DESIGN.md).
 *
 * Every conversation turn is stored verbatim, append-only and immutable,
 * BEFORE any model-led judgement about its value. Condensation into the
 * summary tier is a later, optional, non-destructive enrichment step.
 *
 * Layout (all under the plugin data dir, beside pending-extraction-queue.jsonl):
 *   - raw-blocks.zst            concatenated zstd-compressed block payloads
 *   - raw-blocks.index.jsonl    one metadata line per block, append-only
 *
 * Each line of the index names a block id, its byte offset and compressed
 * length in the blob file, plus the metadata (timestamp, sessionKey, agentId,
 * role, messageId). Fetching one block reads exactly [offset, offset+length)
 * and inflates it with zstd, so any single block restores on its own with no
 * whole-archive dependency (O(1) per block).
 *
 * There is deliberately no delete, rewrite or truncate method: raw text is
 * immutable. A crash between the blob write and the index append can only
 * orphan bytes at the tail of the blob file, which the next append skips over.
 */
export const RAW_BLOCK_BLOB_FILE = "raw-blocks.zst";
export const RAW_BLOCK_INDEX_FILE = "raw-blocks.index.jsonl";
export const RAW_BLOCK_CODEC = "zstd";
export function resolveRawBlockBlobPath(dataDir) {
    return join(dataDir, RAW_BLOCK_BLOB_FILE);
}
export function resolveRawBlockIndexPath(dataDir) {
    return join(dataDir, RAW_BLOCK_INDEX_FILE);
}
/**
 * Stable content-addressed block id. The same (session, role, text) dedupes on
 * append, which keeps agent_end redeliveries and terminal flushes from growing
 * the store with byte-identical blocks. Distinct blocks always get distinct
 * ids; a genuinely repeated identical utterance collapses into one block.
 */
export function rawBlockId(input) {
    return createHash("sha1")
        .update(input.sessionKey)
        .update("\u0000")
        .update(input.role)
        .update("\u0000")
        .update(input.text)
        .digest("hex")
        .slice(0, 24);
}
function isMetadata(value) {
    if (!value || typeof value !== "object")
        return false;
    const candidate = value;
    return (typeof candidate.id === "string" &&
        candidate.id.length > 0 &&
        typeof candidate.sessionKey === "string" &&
        (candidate.role === "user" || candidate.role === "assistant") &&
        typeof candidate.timestamp === "number" &&
        typeof candidate.offset === "number" &&
        candidate.offset >= 0 &&
        typeof candidate.length === "number" &&
        candidate.length >= 0 &&
        typeof candidate.rawLength === "number" &&
        candidate.rawLength >= 0);
}
export class RawBlockStore {
    blobPath;
    indexPath;
    onError;
    level;
    chain = Promise.resolve();
    index = new Map();
    landing = null;
    blobSize = 0;
    constructor(blobPath, indexPath, options = {}) {
        this.blobPath = blobPath;
        this.indexPath = indexPath;
        this.onError = options.onError;
        this.level = options.level;
    }
    get paths() {
        return { blob: this.blobPath, index: this.indexPath };
    }
    report(error) {
        try {
            this.onError?.(error instanceof Error ? error.message : String(error));
        }
        catch {
            /* diagnostics must never throw */
        }
    }
    /** Serialize an async mutation behind every previously queued one. */
    serialize(operation) {
        const run = this.chain.then(operation, operation);
        this.chain = run.then(() => undefined, () => undefined);
        return run;
    }
    load() {
        if (!this.landing) {
            this.landing = this.loadOnce().catch((error) => {
                this.report(error);
            });
        }
        return this.landing;
    }
    async loadOnce() {
        try {
            this.blobSize = (await stat(this.blobPath)).size;
        }
        catch (error) {
            if (error?.code !== "ENOENT")
                this.report(error);
            this.blobSize = 0;
        }
        let raw = "";
        try {
            raw = await readFile(this.indexPath, "utf8");
        }
        catch (error) {
            if (error?.code !== "ENOENT")
                this.report(error);
            return;
        }
        for (const line of raw.split("\n")) {
            if (!line.trim())
                continue;
            try {
                const parsed = JSON.parse(line);
                if (isMetadata(parsed))
                    this.index.set(parsed.id, parsed);
            }
            catch {
                /* skip a torn/unparsable index line rather than failing the store */
            }
        }
    }
    /**
     * Append raw blocks. Invalid inputs (empty text, unknown role, missing
     * session) are dropped; byte-identical duplicates already in the index are
     * skipped. Returns what was actually written.
     */
    async append(blocks) {
        await this.load();
        const prepared = [];
        for (const block of blocks ?? []) {
            if (!block || typeof block !== "object")
                continue;
            if (typeof block.text !== "string" || block.text.length === 0)
                continue;
            if (block.role !== "user" && block.role !== "assistant")
                continue;
            if (typeof block.sessionKey !== "string" || block.sessionKey.length === 0)
                continue;
            prepared.push(block);
        }
        if (prepared.length === 0)
            return { stored: [], skipped: 0 };
        return this.serialize(async () => {
            const stored = [];
            const lines = [];
            let skipped = 0;
            await mkdir(dirname(this.blobPath), { recursive: true });
            const handle = await open(this.blobPath, "a");
            try {
                for (const block of prepared) {
                    const id = rawBlockId(block);
                    if (this.index.has(id)) {
                        skipped += 1;
                        continue;
                    }
                    const textBytes = Buffer.from(block.text, "utf8");
                    const compressed = compressBlock(textBytes, this.level);
                    const offset = this.blobSize;
                    let written = 0;
                    while (written < compressed.length) {
                        const result = await handle.write(compressed, written, compressed.length - written);
                        if (result.bytesWritten <= 0)
                            throw new Error("raw-block blob write stalled");
                        written += result.bytesWritten;
                    }
                    this.blobSize += compressed.length;
                    const meta = {
                        id,
                        sessionKey: block.sessionKey,
                        role: block.role,
                        timestamp: typeof block.timestamp === "number" ? block.timestamp : Date.now(),
                        offset,
                        length: compressed.length,
                        rawLength: textBytes.length,
                        codec: RAW_BLOCK_CODEC,
                    };
                    if (typeof block.agentId === "string" && block.agentId.length > 0) {
                        meta.agentId = block.agentId;
                    }
                    if (typeof block.messageId === "number")
                        meta.messageId = block.messageId;
                    this.index.set(id, meta);
                    stored.push(meta);
                    lines.push(JSON.stringify(meta));
                }
            }
            finally {
                await handle.close();
            }
            if (lines.length > 0) {
                await appendFile(this.indexPath, lines.join("\n") + "\n", "utf8");
            }
            return { stored, skipped };
        });
    }
    has(id) {
        return this.index.has(id);
    }
    /** Metadata for one block, or null. */
    async metadata(id) {
        await this.load();
        return this.index.get(id) ?? null;
    }
    /** Restore exactly one block: read its byte range and inflate it. */
    async get(id) {
        await this.load();
        const meta = this.index.get(id);
        if (!meta)
            return null;
        return this.readMeta(meta);
    }
    /** Restore several blocks, in the requested order, skipping missing ids. */
    async getMany(ids) {
        await this.load();
        const records = [];
        for (const id of ids) {
            const meta = this.index.get(id);
            if (!meta)
                continue;
            const record = await this.readMeta(meta);
            if (record)
                records.push(record);
        }
        return records;
    }
    async readMeta(meta) {
        try {
            const handle = await open(this.blobPath, "r");
            try {
                const buffer = Buffer.alloc(meta.length);
                let read = 0;
                while (read < meta.length) {
                    const result = await handle.read(buffer, read, meta.length - read, meta.offset + read);
                    if (result.bytesRead <= 0)
                        break;
                    read += result.bytesRead;
                }
                if (read < meta.length) {
                    this.report(new Error(`raw block ${meta.id} truncated: ${read}/${meta.length} bytes`));
                    return null;
                }
                return { ...meta, text: decompressBlock(buffer).toString("utf8") };
            }
            finally {
                await handle.close();
            }
        }
        catch (error) {
            this.report(error);
            return null;
        }
    }
    /** Metadata for one session's blocks in deposit order (oldest first). */
    async listBySession(sessionKey, limit) {
        await this.load();
        const matched = [];
        for (const meta of this.index.values()) {
            if (meta.sessionKey === sessionKey)
                matched.push(meta);
        }
        if (typeof limit === "number" && limit >= 0 && matched.length > limit) {
            return matched.slice(-limit);
        }
        return matched;
    }
    /** All block metadata, oldest first. */
    async list() {
        await this.load();
        return [...this.index.values()];
    }
    async size() {
        await this.load();
        let bytes = 0;
        let rawBytes = 0;
        for (const meta of this.index.values()) {
            bytes += meta.length;
            rawBytes += meta.rawLength;
        }
        return { blocks: this.index.size, bytes, rawBytes };
    }
}
/** One log line for a raw-write append (see RAW-FIRST-DESIGN.md). */
export function formatRawWriteLog(result, context) {
    const blocks = result.stored
        .map((block) => `${block.id.slice(0, 8)}:${block.rawLength}`)
        .join(",");
    return (`memory-lancedb-cip: raw-write stored=${result.stored.length} skipped=${result.skipped} ` +
        `session=${context.sessionKey} agent=${context.agentId ?? "unknown"} blocks=[${blocks}]`);
}
