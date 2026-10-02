import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { zstdDecompressSync } from "node:zlib";

import jitiFactory from "jiti";

const jiti = jitiFactory(import.meta.url, { interopDefault: true });
const {
  RAW_BLOCK_BLOB_FILE,
  RAW_BLOCK_CODEC,
  RAW_BLOCK_INDEX_FILE,
  RawBlockStore,
  formatRawWriteLog,
  rawBlockId,
  resolveRawBlockBlobPath,
  resolveRawBlockIndexPath,
} = jiti("../src/raw-store.ts");

function makeDir() {
  return mkdtempSync(path.join(tmpdir(), "mlc-raw-store-"));
}

function makeStore(dir, options = {}) {
  return new RawBlockStore(
    resolveRawBlockBlobPath(dir),
    resolveRawBlockIndexPath(dir),
    options,
  );
}

const BLOCKS = [
  {
    sessionKey: "agent:main:webchat:s1",
    agentId: "main",
    role: "user",
    text: "remember the deploy window is Friday 18:00 UTC",
    messageId: 1,
    timestamp: 1_700_000_000_000,
  },
  {
    sessionKey: "agent:main:webchat:s1",
    agentId: "main",
    role: "assistant",
    text: "noted 记住：部署窗口是周五 18:00 UTC。".repeat(20),
    messageId: 2,
    timestamp: 1_700_000_001_000,
  },
  {
    sessionKey: "agent:main:webchat:s2",
    agentId: "main",
    role: "user",
    text: "second session line",
    timestamp: 1_700_000_002_000,
  },
];

test("raw block round-trips through zstd verbatim", async () => {
  const dir = makeDir();
  try {
    const store = makeStore(dir);
    const result = await store.append(BLOCKS);
    assert.equal(result.stored.length, BLOCKS.length);
    assert.equal(result.skipped, 0);

    for (const block of BLOCKS) {
      const record = await store.get(rawBlockId(block));
      assert.ok(record, "block must restore");
      assert.equal(record.text, block.text, "verbatim text must survive");
      assert.equal(record.role, block.role);
      assert.equal(record.sessionKey, block.sessionKey);
      assert.equal(record.agentId, block.agentId);
      assert.equal(record.codec, RAW_BLOCK_CODEC);
      assert.equal(record.rawLength, Buffer.byteLength(block.text, "utf8"));
    }

    const size = await store.size();
    assert.equal(size.blocks, BLOCKS.length);
    assert.ok(size.bytes > 0);
    assert.equal(
      size.rawBytes,
      BLOCKS.reduce((sum, block) => sum + Buffer.byteLength(block.text, "utf8"), 0),
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("one block restores from its byte range without touching the others", async () => {
  const dir = makeDir();
  try {
    const store = makeStore(dir);
    await store.append(BLOCKS);
    const blobPath = resolveRawBlockBlobPath(dir);

    const before = readFileSync(blobPath);
    const middle = await store.get(rawBlockId(BLOCKS[1]));
    assert.equal(middle.text, BLOCKS[1].text);
    const after = readFileSync(blobPath);
    assert.ok(before.equals(after), "reading a block must not rewrite the archive");

    // The index byte range alone is a complete, self-contained block: inflate
    // exactly [offset, offset+length) and get the same text back.
    const slice = before.subarray(middle.offset, middle.offset + middle.length);
    assert.equal(zstdDecompressSync(slice).toString("utf8"), BLOCKS[1].text);

    // Neighbours are untouched and still restore.
    assert.equal((await store.get(rawBlockId(BLOCKS[0]))).text, BLOCKS[0].text);
    assert.equal((await store.get(rawBlockId(BLOCKS[2]))).text, BLOCKS[2].text);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a fresh instance restores blocks deposited by another generation", async () => {
  const dir = makeDir();
  try {
    await makeStore(dir).append(BLOCKS);
    const reader = makeStore(dir);
    const records = await reader.getMany(BLOCKS.map((block) => rawBlockId(block)));
    assert.deepEqual(
      records.map((record) => record.text),
      BLOCKS.map((block) => block.text),
    );
    const byeSession = await reader.listBySession("agent:main:webchat:s1");
    assert.equal(byeSession.length, 2);
    assert.deepEqual(
      byeSession.map((meta) => meta.role),
      ["user", "assistant"],
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("byte-identical re-append is skipped, not duplicated", async () => {
  const dir = makeDir();
  try {
    const store = makeStore(dir);
    await store.append(BLOCKS);
    const second = await store.append(BLOCKS);
    assert.equal(second.stored.length, 0);
    assert.equal(second.skipped, BLOCKS.length);
    const size = await store.size();
    assert.equal(size.blocks, BLOCKS.length);
    const lines = readFileSync(resolveRawBlockIndexPath(dir), "utf8")
      .split("\n")
      .filter(Boolean);
    assert.equal(lines.length, BLOCKS.length);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the store is append-only and exposes no delete or rewrite", async () => {
  const dir = makeDir();
  try {
    const store = makeStore(dir);
    for (const method of ["remove", "delete", "deleteBlock", "truncate", "rewrite", "update"]) {
      assert.equal(typeof store[method], "undefined", `must not expose ${method}`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("invalid inputs are dropped and a missing file is not an error", async () => {
  const dir = makeDir();
  try {
    const empty = makeStore(dir);
    assert.equal(await empty.get("missing"), null);
    assert.equal((await empty.size()).blocks, 0);
    assert.equal((await empty.getMany(["a", "b"])).length, 0);

    const result = await empty.append([
      { sessionKey: "s1", role: "user", text: "" },
      { sessionKey: "s1", role: "system", text: "nope" },
      { sessionKey: "", role: "user", text: "nope" },
      { sessionKey: "s1", role: "user", text: "kept" },
    ]);
    assert.equal(result.stored.length, 1);
    assert.equal((await empty.get(rawBlockId({ sessionKey: "s1", role: "user", text: "kept" }))).text, "kept");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("raw-write log line names stored/skipped and the session", async () => {
  const dir = makeDir();
  try {
    const store = makeStore(dir);
    const result = await store.append([BLOCKS[0]]);
    const line = formatRawWriteLog(result, { sessionKey: BLOCKS[0].sessionKey, agentId: "main" });
    assert.match(line, /^memory-lancedb-cip: raw-write stored=1 skipped=0 /);
    assert.match(line, /session=agent:main:webchat:s1/);
    assert.match(line, /agent=main/);
    assert.match(line, /blocks=\[[0-9a-f]{8}:\d+\]/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
