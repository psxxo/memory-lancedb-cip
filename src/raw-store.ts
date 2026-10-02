import { createHash } from "node:crypto";
import { appendFile, copyFile, mkdir, open, readFile, stat } from "node:fs/promises";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import * as nodeZlib from "node:zlib";

/**
 * Raw tier of the two-tier memory store (see RAW-FIRST-DESIGN.md).
 *
 * Every conversation turn is stored verbatim, append-only and immutable, BEFORE
 * any model-led judgement about its value. Condensation into the summary tier is
 * a later, optional, non-destructive enrichment step.
 *
 * Layout, all under the plugin data dir (the directory that holds memories.lance):
 *   - raw-blocks.zst              concatenated per-block zstd frames (the payload)
 *   - raw-blocks.index.zst        append-only framed zstd index (see below)
 *   - raw-blocks.dict.<hash>      a trained zstd dictionary (optional, immutable)
 *   - raw-blocks.dict.current     pointer file holding the current dictionary hash
 *
 * INDEX FORMAT (v2): the file is a sequence of length-prefixed frames,
 * [u32 little-endian frameLength][zstd frame]. Each frame holds one append
 * batch as compact JSON with per-frame string tables, so a frame is
 * self-contained and safe to append from any process generation:
 *   {"s":[sessionKeys],"a":[agentIds],"dh":"<dictHash>","b":[[id,si,ai,rb,ts,o,l,n,mid],...]}
 * Frames are compressed WITHOUT a dictionary, so the index never depends on a
 * dictionary file. A torn final frame reads short and is skipped; every earlier
 * frame still loads. Fetching one block reads exactly [offset, offset+length)
 * from the blob and inflates it (with the block's dictionary, if any) - O(1),
 * no whole-archive dependency.
 *
 * There is deliberately no delete, rewrite or truncate method for raw text.
 */

export const RAW_BLOCK_BLOB_FILE = "raw-blocks.zst";
export const RAW_BLOCK_INDEX_FILE = "raw-blocks.index.zst";
export const RAW_BLOCK_CODEC = "zstd";
export const RAW_BLOCK_LEVEL = 19;
export const RAW_BLOCK_DICT_PREFIX = "raw-blocks.dict.";
export const RAW_BLOCK_DICT_POINTER = "raw-blocks.dict.current";
export const LEGACY_RAW_BLOCK_INDEX_FILE = "raw-blocks.index.jsonl";

const ZSTD_LEVEL_PARAM = 100; // ZSTD_c_compressionLevel
const NEWLINE = String.fromCharCode(10);
const NUL = String.fromCharCode(0);

export type RawBlockRole = "user" | "assistant";

export interface RawBlockInput {
  sessionKey: string;
  agentId?: string;
  role: RawBlockRole;
  text: string;
  messageId?: number;
  timestamp?: number;
}

export interface RawBlockMetadata {
  id: string;
  sessionKey: string;
  agentId?: string;
  role: RawBlockRole;
  messageId?: number;
  timestamp: number;
  offset: number;
  length: number;
  rawLength: number;
  codec: string;
  /** Hash of the zstd dictionary this frame was compressed with, if any. */
  dictHash?: string;
}

export interface RawBlockRecord extends RawBlockMetadata {
  text: string;
}

export interface RawAppendResult {
  stored: RawBlockMetadata[];
  skipped: number;
}

export interface RawBlockStoreOptions {
  onError?: (message: string) => void;
  /** Best-effort lifecycle notes (migration, an unusable dictionary, ...). */
  onLog?: (message: string) => void;
  /** Older raw location to import from once, when the new index is absent. */
  legacyDir?: string;
  /** Explicit dictionary file for this instance (overrides the pointer file). */
  dictionaryPath?: string;
}

export interface RawBlockSize {
  blocks: number;
  /** Compressed payload bytes in the blob. */
  bytes: number;
  /** Compressed index bytes. */
  indexBytes: number;
  /** Uncompressed bytes represented. */
  rawBytes: number;
}

export function resolveRawBlockBlobPath(dataDir: string): string {
  return join(dataDir, RAW_BLOCK_BLOB_FILE);
}
export function resolveRawBlockIndexPath(dataDir: string): string {
  return join(dataDir, RAW_BLOCK_INDEX_FILE);
}
export function resolveRawBlockDictPath(dataDir: string, hash: string): string {
  return join(dataDir, RAW_BLOCK_DICT_PREFIX + hash);
}
export function resolveRawBlockDictPointerPath(dataDir: string): string {
  return join(dataDir, RAW_BLOCK_DICT_POINTER);
}
export function resolveLegacyRawBlockBlobPath(legacyDir: string): string {
  return join(legacyDir, RAW_BLOCK_BLOB_FILE);
}
export function resolveLegacyRawBlockIndexPath(legacyDir: string): string {
  return join(legacyDir, LEGACY_RAW_BLOCK_INDEX_FILE);
}

export function sha256Hex(data: Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

interface ZstdCodec {
  zstdCompressSync(data: Buffer, options?: { params?: Record<string, number>; dictionary?: Buffer }): Buffer;
  zstdDecompressSync(data: Buffer, options?: { dictionary?: Buffer }): Buffer;
}

const zstd = nodeZlib as unknown as Partial<ZstdCodec>;

function assertZstd(): ZstdCodec {
  if (typeof zstd.zstdCompressSync !== "function" || typeof zstd.zstdDecompressSync !== "function") {
    throw new Error("node:zlib does not expose the zstd codecs (Node 22.15+ required)");
  }
  return zstd as ZstdCodec;
}

function compressBlock(data: Buffer, level: number, dictionary?: Buffer): Buffer {
  const codec = assertZstd();
  const options: { params?: Record<string, number>; dictionary?: Buffer } = {
    params: { [ZSTD_LEVEL_PARAM]: level },
  };
  if (dictionary && dictionary.length > 0) options.dictionary = dictionary;
  return codec.zstdCompressSync(data, options);
}

function decompressBlock(data: Buffer, dictionary?: Buffer): Buffer {
  const codec = assertZstd();
  return dictionary && dictionary.length > 0
    ? codec.zstdDecompressSync(data, { dictionary })
    : codec.zstdDecompressSync(data);
}

/** Try the named dictionary first, then fall back to a plain frame. */
function tryDecompress(data: Buffer, dictionary?: Buffer): Buffer {
  try {
    return decompressBlock(data, dictionary);
  } catch (error) {
    if (dictionary) {
      try {
        return decompressBlock(data, undefined);
      } catch {
        throw error;
      }
    }
    throw error;
  }
}

export function rawBlockId(input: Pick<RawBlockInput, "sessionKey" | "role" | "text">): string {
  return createHash("sha1")
    .update(input.sessionKey)
    .update(NUL)
    .update(input.role)
    .update(NUL)
    .update(input.text)
    .digest("hex")
    .slice(0, 24);
}

function isLegacyMetadata(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const c = value as Record<string, unknown>;
  return (
    typeof c.id === "string" && c.id.length > 0 &&
    typeof c.sessionKey === "string" &&
    (c.role === "user" || c.role === "assistant") &&
    typeof c.timestamp === "number" &&
    typeof c.offset === "number" &&
    typeof c.length === "number" &&
    typeof c.rawLength === "number"
  );
}

export class RawBlockStore {
  private readonly dataDir: string;
  private readonly onError?: (message: string) => void;
  private readonly onLog?: (message: string) => void;
  private readonly legacyDir?: string;
  private readonly dictionaryPath?: string;
  private chain: Promise<void> = Promise.resolve();
  private readonly index = new Map<string, RawBlockMetadata>();
  private readonly dictCache = new Map<string, Buffer | null>();
  private landing: Promise<void> | null = null;
  private blobSize = 0;
  private currentDictHash: string | undefined;
  private currentDict: Buffer | undefined;

  constructor(dataDir: string, options: RawBlockStoreOptions = {}) {
    this.dataDir = dataDir;
    this.onError = options.onError;
    this.onLog = options.onLog;
    this.legacyDir = options.legacyDir;
    this.dictionaryPath = options.dictionaryPath;
  }

  get paths(): { dataDir: string; blob: string; index: string } {
    return {
      dataDir: this.dataDir,
      blob: resolveRawBlockBlobPath(this.dataDir),
      index: resolveRawBlockIndexPath(this.dataDir),
    };
  }

  get dictionaryHash(): string | undefined {
    return this.currentDictHash;
  }

  private report(error: unknown): void {
    try {
      this.onError?.(error instanceof Error ? error.message : String(error));
    } catch {
      /* diagnostics must never throw */
    }
  }

  private note(message: string): void {
    try {
      this.onLog?.(message);
    } catch {
      /* diagnostics must never throw */
    }
  }

  private serialize<T>(operation: () => Promise<T>): Promise<T> {
    const run = this.chain.then(operation, operation);
    this.chain = run.then(() => undefined, () => undefined);
    return run;
  }

  private load(): Promise<void> {
    if (!this.landing) {
      this.landing = this.loadOnce().catch((error) => this.report(error));
    }
    return this.landing;
  }

  private async loadDict(hash: string): Promise<Buffer | undefined> {
    if (this.dictCache.has(hash)) return this.dictCache.get(hash) ?? undefined;
    try {
      const dict = await readFile(resolveRawBlockDictPath(this.dataDir, hash));
      this.dictCache.set(hash, dict);
      return dict;
    } catch {
      this.dictCache.set(hash, null);
      return undefined;
    }
  }

  private async loadOnce(): Promise<void> {
    try {
      this.blobSize = (await stat(resolveRawBlockBlobPath(this.dataDir))).size;
    } catch (error) {
      if ((error as NodeJS.ErrnoException | undefined)?.code !== "ENOENT") this.report(error);
      this.blobSize = 0;
    }

    // Current dictionary: explicit path wins, else the pointer file.
    try {
      if (this.dictionaryPath) {
        const dict = await readFile(this.dictionaryPath);
        const hash = sha256Hex(dict).slice(0, 16);
        this.dictCache.set(hash, dict);
        this.currentDictHash = hash;
        this.currentDict = dict;
      } else {
        const hash = (await readFile(resolveRawBlockDictPointerPath(this.dataDir), "utf8")).trim();
        if (/^[0-9a-f]{8,64}$/.test(hash)) {
          const dict = await this.loadDict(hash);
          if (dict) {
            this.currentDictHash = hash;
            this.currentDict = dict;
          } else {
            this.note("memory-lancedb-cip: raw-store dictionary " + hash + " is missing; new blocks stay uncompressed-by-dictionary");
          }
        }
      }
    } catch {
      /* no dictionary configured - fine */
    }

    let raw: Buffer | null = null;
    try {
      raw = await readFile(resolveRawBlockIndexPath(this.dataDir));
    } catch (error) {
      if ((error as NodeJS.ErrnoException | undefined)?.code !== "ENOENT") this.report(error);
    }

    if (raw && raw.length > 0) {
      this.parseIndex(raw);
      return;
    }
    if (this.legacyDir) await this.migrateLegacy();
  }

  private parseIndex(raw: Buffer): void {
    let offset = 0;
    while (offset + 4 <= raw.length) {
      const frameLength = raw.readUInt32LE(offset);
      if (frameLength <= 0 || offset + 4 + frameLength > raw.length) break; // torn tail
      const frame = raw.subarray(offset + 4, offset + 4 + frameLength);
      offset += 4 + frameLength;
      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(tryDecompress(frame).toString("utf8")) as Record<string, unknown>;
      } catch (error) {
        this.report(error);
        break;
      }
      const sessions = Array.isArray(parsed.s) ? (parsed.s as unknown[]) : [];
      const agents = Array.isArray(parsed.a) ? (parsed.a as unknown[]) : [];
      const dh = typeof parsed.dh === "string" ? parsed.dh : undefined;
      const records = Array.isArray(parsed.b) ? (parsed.b as unknown[][]) : [];
      for (const rec of records) {
        if (!Array.isArray(rec) || rec.length < 9) continue;
        const id = rec[0];
        if (typeof id !== "string" || id.length === 0 || this.index.has(id)) continue;
        const si = Number(rec[1]);
        const ai = Number(rec[2]);
        const rb = Number(rec[3]);
        const timestamp = Number(rec[4]);
        const blockOffset = Number(rec[5]);
        const length = Number(rec[6]);
        const rawLength = Number(rec[7]);
        const mid = Number(rec[8]);
        const meta: RawBlockMetadata = {
          id,
          sessionKey: typeof sessions[si] === "string" ? (sessions[si] as string) : "",
          role: rb ? "assistant" : "user",
          timestamp,
          offset: blockOffset,
          length,
          rawLength,
          codec: RAW_BLOCK_CODEC,
        };
        if (Number.isFinite(ai) && ai >= 0 && typeof agents[ai] === "string") meta.agentId = agents[ai] as string;
        if (Number.isFinite(mid) && mid > 0) meta.messageId = mid;
        if (dh) meta.dictHash = dh;
        this.index.set(id, meta);
      }
    }
  }

  private encodeFrame(metas: RawBlockMetadata[], dictHash?: string): Buffer {
    const sessions: string[] = [];
    const agents: string[] = [];
    const records: unknown[][] = [];
    for (const meta of metas) {
      let si = sessions.indexOf(meta.sessionKey);
      if (si < 0) { si = sessions.length; sessions.push(meta.sessionKey); }
      let ai = -1;
      if (meta.agentId) {
        ai = agents.indexOf(meta.agentId);
        if (ai < 0) { ai = agents.length; agents.push(meta.agentId); }
      }
      records.push([
        meta.id, si, ai, meta.role === "assistant" ? 1 : 0,
        meta.timestamp, meta.offset, meta.length, meta.rawLength, meta.messageId ?? 0,
      ]);
    }
    const obj: Record<string, unknown> = { s: sessions, a: agents, b: records };
    if (dictHash) obj.dh = dictHash;
    const frame = compressBlock(Buffer.from(JSON.stringify(obj), "utf8"), RAW_BLOCK_LEVEL);
    const out = Buffer.alloc(4 + frame.length);
    out.writeUInt32LE(frame.length, 0);
    frame.copy(out, 4);
    return out;
  }

  private async migrateLegacy(): Promise<void> {
    const legacyIndexPath = resolveLegacyRawBlockIndexPath(this.legacyDir as string);
    if (!existsSync(legacyIndexPath)) return;
    const lines = readFileSync(legacyIndexPath, "utf8").split(NEWLINE).filter((line) => line.trim().length > 0);
    if (lines.length === 0) return;
    const metas: RawBlockMetadata[] = [];
    for (const line of lines) {
      try {
        const parsed = JSON.parse(line);
        if (isLegacyMetadata(parsed)) {
          const meta: RawBlockMetadata = {
            id: parsed.id, sessionKey: parsed.sessionKey, role: parsed.role,
            timestamp: parsed.timestamp, offset: parsed.offset, length: parsed.length,
            rawLength: parsed.rawLength, codec: RAW_BLOCK_CODEC,
          };
          if (typeof parsed.agentId === "string") meta.agentId = parsed.agentId;
          if (typeof parsed.messageId === "number") meta.messageId = parsed.messageId;
          metas.push(meta);
        }
      } catch {
        /* skip a torn legacy line */
      }
    }
    if (metas.length === 0) return;
    await mkdir(this.dataDir, { recursive: true });
    const newBlobPath = resolveRawBlockBlobPath(this.dataDir);
    const legacyBlobPath = resolveLegacyRawBlockBlobPath(this.legacyDir as string);
    if (!existsSync(newBlobPath) && existsSync(legacyBlobPath)) {
      await copyFile(legacyBlobPath, newBlobPath);
      this.blobSize = statSync(newBlobPath).size;
    }
    this.index.clear();
    for (const meta of metas) this.index.set(meta.id, meta);
    await appendFile(resolveRawBlockIndexPath(this.dataDir), this.encodeFrame(metas));
    this.note("memory-lancedb-cip: raw-store migrated " + metas.length + " legacy block(s) from " + this.legacyDir);
  }

  async append(blocks: RawBlockInput[]): Promise<RawAppendResult> {
    await this.load();
    const prepared: RawBlockInput[] = [];
    for (const block of blocks ?? []) {
      if (!block || typeof block !== "object") continue;
      if (typeof block.text !== "string" || block.text.length === 0) continue;
      if (block.role !== "user" && block.role !== "assistant") continue;
      if (typeof block.sessionKey !== "string" || block.sessionKey.length === 0) continue;
      prepared.push(block);
    }
    if (prepared.length === 0) return { stored: [], skipped: 0 };
    return this.serialize(async () => {
      const stored: RawBlockMetadata[] = [];
      let skipped = 0;
      await mkdir(this.dataDir, { recursive: true });
      const handle = await open(resolveRawBlockBlobPath(this.dataDir), "a");
      try {
        for (const block of prepared) {
          const id = rawBlockId(block);
          if (this.index.has(id)) { skipped += 1; continue; }
          const textBytes = Buffer.from(block.text, "utf8");
          const compressed = compressBlock(textBytes, RAW_BLOCK_LEVEL, this.currentDict);
          const offset = this.blobSize;
          let written = 0;
          while (written < compressed.length) {
            const result = await handle.write(compressed, written, compressed.length - written);
            if (result.bytesWritten <= 0) throw new Error("raw-block blob write stalled");
            written += result.bytesWritten;
          }
          this.blobSize += compressed.length;
          const meta: RawBlockMetadata = {
            id, sessionKey: block.sessionKey, role: block.role,
            timestamp: typeof block.timestamp === "number" ? block.timestamp : Date.now(),
            offset, length: compressed.length, rawLength: textBytes.length, codec: RAW_BLOCK_CODEC,
          };
          if (typeof block.agentId === "string" && block.agentId.length > 0) meta.agentId = block.agentId;
          if (typeof block.messageId === "number") meta.messageId = block.messageId;
          if (this.currentDictHash) meta.dictHash = this.currentDictHash;
          this.index.set(id, meta);
          stored.push(meta);
        }
      } finally {
        await handle.close();
      }
      if (stored.length > 0) {
        await appendFile(resolveRawBlockIndexPath(this.dataDir), this.encodeFrame(stored, this.currentDictHash));
      }
      return { stored, skipped };
    });
  }

  has(id: string): boolean {
    return this.index.has(id);
  }

  async metadata(id: string): Promise<RawBlockMetadata | null> {
    await this.load();
    return this.index.get(id) ?? null;
  }

  async get(id: string): Promise<RawBlockRecord | null> {
    await this.load();
    const meta = this.index.get(id);
    if (!meta) return null;
    return this.readMeta(meta);
  }

  async getMany(ids: Iterable<string>): Promise<RawBlockRecord[]> {
    await this.load();
    const records: RawBlockRecord[] = [];
    for (const id of ids) {
      const meta = this.index.get(id);
      if (!meta) continue;
      const record = await this.readMeta(meta);
      if (record) records.push(record);
    }
    return records;
  }

  private async readMeta(meta: RawBlockMetadata): Promise<RawBlockRecord | null> {
    try {
      const dictionary = meta.dictHash ? await this.loadDict(meta.dictHash) : undefined;
      const handle = await open(resolveRawBlockBlobPath(this.dataDir), "r");
      try {
        const buffer = Buffer.alloc(meta.length);
        let read = 0;
        while (read < meta.length) {
          const result = await handle.read(buffer, read, meta.length - read, meta.offset + read);
          if (result.bytesRead <= 0) break;
          read += result.bytesRead;
        }
        if (read < meta.length) {
          this.report(new Error("raw block " + meta.id + " truncated: " + read + "/" + meta.length + " bytes"));
          return null;
        }
        return { ...meta, text: tryDecompress(buffer, dictionary).toString("utf8") };
      } finally {
        await handle.close();
      }
    } catch (error) {
      this.report(error);
      return null;
    }
  }

  async listBySession(sessionKey: string, limit?: number): Promise<RawBlockMetadata[]> {
    await this.load();
    const matched: RawBlockMetadata[] = [];
    for (const meta of this.index.values()) {
      if (meta.sessionKey === sessionKey) matched.push(meta);
    }
    if (typeof limit === "number" && limit >= 0 && matched.length > limit) return matched.slice(-limit);
    return matched;
  }

  async list(): Promise<RawBlockMetadata[]> {
    await this.load();
    return [...this.index.values()];
  }

  async size(): Promise<RawBlockSize> {
    await this.load();
    let bytes = 0;
    let rawBytes = 0;
    for (const meta of this.index.values()) {
      bytes += meta.length;
      rawBytes += meta.rawLength;
    }
    let indexBytes = 0;
    try {
      indexBytes = (await stat(resolveRawBlockIndexPath(this.dataDir))).size;
    } catch {
      indexBytes = 0;
    }
    return { blocks: this.index.size, bytes, indexBytes, rawBytes };
  }
}

/** One log line for a raw-write append (see RAW-FIRST-DESIGN.md). */
export function formatRawWriteLog(
  result: RawAppendResult,
  context: { sessionKey: string; agentId?: string; dictHash?: string },
): string {
  const blocks = result.stored
    .map((block) => block.id.slice(0, 8) + ":" + block.rawLength)
    .join(",");
  const dict = context.dictHash ? context.dictHash.slice(0, 8) : "none";
  return (
    "memory-lancedb-cip: raw-write stored=" + result.stored.length +
    " skipped=" + result.skipped +
    " session=" + context.sessionKey +
    " agent=" + (context.agentId ?? "unknown") +
    " dict=" + dict +
    " blocks=[" + blocks + "]"
  );
}
