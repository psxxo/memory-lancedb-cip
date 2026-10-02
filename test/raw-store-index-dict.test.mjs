import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { zstdCompressSync } from "node:zlib";

import jitiFactory from "jiti";

const jiti = jitiFactory(import.meta.url, { interopDefault: true });
const {
  RawBlockStore,
  rawBlockId,
  resolveRawBlockBlobPath,
  resolveRawBlockDictPath,
  resolveRawBlockDictPointerPath,
  resolveRawBlockIndexPath,
  sha256Hex,
} = jiti("../src/raw-store.ts");

function makeDir(prefix) {
  return mkdtempSync(path.join(tmpdir(), prefix));
}

// A small dictionary file just has to be valid bytes for zstd to use it.
const DICT = Buffer.from("agent:main conversation memory deploy window friday rollback ".repeat(40));
const DICT_HASH = sha256Hex(DICT).slice(0, 16);

function installDict(dir) {
  writeFileSync(resolveRawBlockDictPath(dir, DICT_HASH), DICT);
  writeFileSync(resolveRawBlockDictPointerPath(dir), DICT_HASH + "\n");
}

function blocks(n) {
  const out = [];
  for (let i = 0; i < n; i++) {
    out.push({
      sessionKey: "agent:main:main",
      agentId: "main",
      role: i % 2 === 0 ? "user" : "assistant",
      text: "message number " + i + " about the deploy window, rollback plan, and friday 18:00 UTC " + i,
      messageId: i + 1,
      timestamp: 1_700_000_000_000 + i,
    });
  }
  return out;
}

test("dictionary round-trip: blocks written with a dict restore with the dict", async () => {
  const dir = makeDir("mlc-dict-");
  try {
    installDict(dir);
    const store = new RawBlockStore(dir);
    const input = blocks(5);
    const result = await store.append(input);
    assert.equal(result.stored.length, 5);
    assert.ok(result.stored.every((m) => m.dictHash === DICT_HASH), "each block must record its dictionary");
    assert.equal(store.dictionaryHash, DICT_HASH);

    const reader = new RawBlockStore(dir);
    for (const block of input) {
      const record = await reader.get(rawBlockId(block));
      assert.ok(record);
      assert.equal(record.text, block.text);
      assert.equal(record.dictHash, DICT_HASH);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("blocks still restore when no dictionary is configured", async () => {
  const dir = makeDir("mlc-nodict-");
  try {
    const store = new RawBlockStore(dir);
    await store.append(blocks(3));
    assert.equal(store.dictionaryHash, undefined);
    const reader = new RawBlockStore(dir);
    assert.equal((await reader.get(rawBlockId(blocks(3)[1]))).text, blocks(3)[1].text);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the framed index is far smaller than the JSONL it replaces", async () => {
  const dir = makeDir("mlc-index-");
  try {
    installDict(dir);
    const input = blocks(40);
    const store = new RawBlockStore(dir);
    await store.append(input);
    const indexBytes = (await store.size()).indexBytes;
    // A JSONL index with the 1.5.0 field set would be ~200 bytes per block.
    const jsonlEquivalent = input
      .map((b, i) => JSON.stringify({ id: rawBlockId(b), sessionKey: b.sessionKey, agentId: b.agentId, role: b.role, timestamp: b.timestamp, offset: i * 100, length: 50, rawLength: 60, codec: "zstd", messageId: b.messageId }))
      .join("\n").length;
    assert.ok(indexBytes < jsonlEquivalent / 3, "framed index must be at least 3x smaller (got " + indexBytes + " vs " + jsonlEquivalent + ")");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a torn tail frame is skipped, earlier frames still load", async () => {
  const dir = makeDir("mlc-torn-");
  try {
    const store = new RawBlockStore(dir);
    await store.append([blocks(1)[0]]);
    await store.append([blocks(3)[2]]);
    await store.append([blocks(3)[1]]);
    const indexPath = resolveRawBlockIndexPath(dir);
    const raw = readFileSync(indexPath);
    // Drop two bytes off the last frame: it must be treated as torn.
    writeFileSync(indexPath, raw.subarray(0, raw.length - 2));
    const reader = new RawBlockStore(dir);
    assert.ok(await reader.get(rawBlockId(blocks(1)[0])), "first frame survives");
    assert.ok(await reader.get(rawBlockId(blocks(3)[2])), "second frame survives");
    assert.equal(await reader.get(rawBlockId(blocks(3)[1])), null, "torn last frame is skipped");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("legacy JSONL raw files are migrated once into the plugin data dir", async () => {
  const legacyDir = makeDir("mlc-legacy-");
  const dataDir = makeDir("mlc-new-");
  try {
    const t1 = Buffer.from("first legacy message");
    const t2 = Buffer.from("second legacy message");
    const c1 = zstdCompressSync(t1);
    const c2 = zstdCompressSync(t2);
    writeFileSync(resolveRawBlockBlobPath(legacyDir), Buffer.concat([c1, c2]));
    const id1 = rawBlockId({ sessionKey: "s", role: "user", text: "first legacy message" });
    const id2 = rawBlockId({ sessionKey: "s", role: "assistant", text: "second legacy message" });
    writeFileSync(
      path.join(legacyDir, "raw-blocks.index.jsonl"),
      [
        JSON.stringify({ id: id1, sessionKey: "s", agentId: "main", role: "user", timestamp: 1, offset: 0, length: c1.length, rawLength: t1.length, codec: "zstd", messageId: 1 }),
        JSON.stringify({ id: id2, sessionKey: "s", agentId: "main", role: "assistant", timestamp: 2, offset: c1.length, length: c2.length, rawLength: t2.length, codec: "zstd", messageId: 2 }),
      ].join("\n") + "\n",
    );
    const notes = [];
    const store = new RawBlockStore(dataDir, { legacyDir, onLog: (m) => notes.push(m) });
    const first = await store.get(id1);
    const second = await store.get(id2);
    assert.equal(first.text, "first legacy message");
    assert.equal(second.text, "second legacy message");
    assert.ok(existsSync(resolveRawBlockIndexPath(dataDir)), "new index written");
    assert.ok(existsSync(path.join(legacyDir, "raw-blocks.index.jsonl")), "legacy files are left in place");
    assert.ok(notes.some((m) => m.includes("migrated 2 legacy block")), "migration is logged");
  } finally {
    rmSync(legacyDir, { recursive: true, force: true });
    rmSync(dataDir, { recursive: true, force: true });
  }
});
