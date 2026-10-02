import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { zstdCompressSync, zstdDecompressSync } from "node:zlib";

/**
 * Train the raw tier's zstd dictionary on text representative of this host's
 * conversations, then install it next to the raw blocks as
 * raw-blocks.dict.<hash> plus the raw-blocks.dict.current pointer.
 *
 * Sources: the live raw blocks (decoded), the workspace daily records, and the
 * zstd-compressed session transcripts. The dictionary is immutable once
 * written (hash-named); this script never overwrites an existing one.
 *
 * Run: node scripts/train-raw-dict.mjs [--data-dir <dir>] [--max-dict <bytes>]
 *
 * If the zstd CLI is unavailable, it falls back to a raw-content dictionary
 * built from the collected samples (still usable by node:zlib).
 */

const NEWLINE = String.fromCharCode(10);

function argValue(flag, fallback) {
  const index = process.argv.indexOf(flag);
  return index !== -1 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

const dataDir = argValue("--data-dir", path.join(homedir(), ".openclaw", "memory", "lancedb-cip"));
const maxDict = Number(argValue("--max-dict", "65536"));
const workspaceDir = argValue("--workspace", path.join(homedir(), ".openclaw", "workspace"));
const sessionsDir = argValue("--sessions", path.join(homedir(), ".openclaw", "agents", "main", "sessions"));
const includeWorkspace = process.argv.includes("--include-workspace");
const includeSessions = process.argv.includes("--include-sessions");
const samplesDir = path.join(tmpdir(), "mlc-raw-dict-samples-" + process.pid);

function listDicts(dir) {
  const dicts = [];
  if (!existsSync(dir)) return dicts;
  for (const name of readdirSync(dir)) {
    if (name.startsWith("raw-blocks.dict.") && !name.endsWith(".current")) {
      try { dicts.push(readFileSync(path.join(dir, name))); } catch {}
    }
  }
  return dicts;
}

const dicts = [...listDicts(dataDir), ...listDicts(path.dirname(dataDir))];

function inflate(frame) {
  for (const dictionary of dicts) {
    try { return zstdDecompressSync(frame, { dictionary }); } catch {}
  }
  try { return zstdDecompressSync(frame); } catch { return null; }
}

const texts = [];
const seen = new Set();
function push(text) {
  if (typeof text !== "string") return;
  const trimmed = text.trim();
  if (trimmed.length < 24 || seen.has(trimmed)) return;
  seen.add(trimmed);
  texts.push(trimmed);
}

function readBlobFrames(dir) {
  const blobPath = path.join(dir, "raw-blocks.zst");
  if (!existsSync(blobPath)) return;
  const blob = readFileSync(blobPath);
  let records = [];
  const newIndex = path.join(dir, "raw-blocks.index.zst");
  const legacyIndex = path.join(dir, "raw-blocks.index.jsonl");
  if (existsSync(newIndex)) {
    const raw = readFileSync(newIndex);
    let off = 0;
    while (off + 4 <= raw.length) {
      const len = raw.readUInt32LE(off);
      if (len <= 0 || off + 4 + len > raw.length) break;
      const frame = raw.subarray(off + 4, off + 4 + len);
      off += 4 + len;
      try {
        const obj = JSON.parse(zstdDecompressSync(frame).toString("utf8"));
        for (const r of obj.b ?? []) records.push({ offset: Number(r[5]), length: Number(r[6]) });
      } catch {}
    }
  } else if (existsSync(legacyIndex)) {
    for (const line of readFileSync(legacyIndex, "utf8").split(NEWLINE)) {
      if (!line.trim()) continue;
      try { const p = JSON.parse(line); records.push({ offset: p.offset, length: p.length }); } catch {}
    }
  }
  for (const r of records) {
    if (!Number.isFinite(r.offset) || !Number.isFinite(r.length) || r.length <= 0) continue;
    if (r.offset + r.length > blob.length) continue;
    const decoded = inflate(blob.subarray(r.offset, r.offset + r.length));
    if (decoded) push(decoded.toString("utf8"));
  }
}

readBlobFrames(dataDir);
readBlobFrames(path.dirname(dataDir));

const memoryDir = path.join(workspaceDir, "memory");
if (includeWorkspace && existsSync(memoryDir)) {
  for (const name of readdirSync(memoryDir)) {
    if (!name.endsWith(".md")) continue;
    try {
      for (const para of readFileSync(path.join(memoryDir, name), "utf8").split(NEWLINE + NEWLINE)) push(para);
    } catch {}
  }
}

if (includeSessions && existsSync(sessionsDir)) {
  for (const name of readdirSync(sessionsDir)) {
    if (!name.endsWith(".zst")) continue;
    let raw;
    try { raw = zstdDecompressSync(readFileSync(path.join(sessionsDir, name))).toString("utf8"); } catch { continue; }
    for (const line of raw.split(NEWLINE)) {
      if (!line.trim()) continue;
      try {
        const obj = JSON.parse(line);
        const content = obj.content ?? (obj.message ? obj.message.content : undefined) ?? obj.text;
        if (typeof content === "string") push(content);
        else if (Array.isArray(content)) for (const block of content) if (typeof block.text === "string") push(block.text);
      } catch {}
    }
  }
}

if (texts.length === 0) {
  console.error("train-raw-dict: no sample text found; nothing to train");
  process.exit(1);
}

rmSync(samplesDir, { recursive: true, force: true });
mkdirSync(samplesDir, { recursive: true });
let sampleCount = 0;
for (const text of texts) {
  for (let i = 0; i < text.length; i += 2048) {
    const chunk = text.slice(i, i + 2048);
    if (chunk.length >= 24) writeFileSync(path.join(samplesDir, "s" + String(sampleCount++).padStart(6, "0")), chunk);
  }
}

const samples = readdirSync(samplesDir).map((name) => path.join(samplesDir, name));
const corpusBytes = samples.reduce((sum, file) => sum + readFileSync(file).length, 0);
const targetSize = Math.max(8192, Math.min(maxDict, Math.floor(corpusBytes / 4)));
const outPath = path.join(tmpdir(), "mlc-raw-dict-" + process.pid);

let trained = false;
try {
  execFileSync("zstd", ["--train", ...samples, "-o", outPath, "--maxdict=" + targetSize], { stdio: "ignore" });
  trained = existsSync(outPath);
} catch {
  trained = false;
}

let dictionary;
if (trained) {
  dictionary = readFileSync(outPath);
} else {
  // Fallback: raw-content dictionary from the most recent sample text.
  const joined = Buffer.concat(samples.slice(-Math.max(1, Math.floor(samples.length / 2))).map((file) => readFileSync(file)));
  dictionary = joined.subarray(Math.max(0, joined.length - targetSize));
}

const hash = createHash("sha256").update(dictionary).digest("hex").slice(0, 16);
mkdirSync(dataDir, { recursive: true });
const dictPath = path.join(dataDir, "raw-blocks.dict." + hash);
if (!existsSync(dictPath)) writeFileSync(dictPath, dictionary);
writeFileSync(path.join(dataDir, "raw-blocks.dict.current"), hash + NEWLINE);

// Quick honesty check: report the on-corpus ratio with and without the dictionary.
let withDict = 0;
let without = 0;
const probe = texts.slice(-40);
for (const text of probe) {
  const buf = Buffer.from(text);
  without += zstdCompressSync(buf, { params: { 100: 19 } }).length;
  withDict += zstdCompressSync(buf, { params: { 100: 19 }, dictionary }).length;
}

rmSync(samplesDir, { recursive: true, force: true });
rmSync(outPath, { force: true });

console.log(JSON.stringify({
  samples: sampleCount,
  corpusBytes,
  dictionaryBytes: dictionary.length,
  dictionaryHash: hash,
  dictPath,
  trainedByCli: trained,
  probeBlocks: probe.length,
  probeWithoutDict: without,
  probeWithDict: withDict,
  probeRatioWithDict: Number((without / withDict).toFixed(3)),
}, null, 2));
