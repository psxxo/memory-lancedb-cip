import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import jitiFactory from "jiti";

const jiti = jitiFactory(import.meta.url, { interopDefault: true });
const { PendingExtractionQueueStore, resolvePendingExtractionQueuePath } = jiti(
  "../src/extraction-queue.ts",
);

function makeDir() {
  return mkdtempSync(path.join(tmpdir(), "mlc-extraction-queue-"));
}

test("deposit in one store instance is drained by a fresh instance", async () => {
  const dir = makeDir();
  try {
    const queuePath = resolvePendingExtractionQueuePath(dir);
    const writer = new PendingExtractionQueueStore(queuePath);
    await writer.append("agent:main:webchat:s1", [
      { role: "user", text: "remember the deploy window is Friday", messageId: 1 },
      { role: "assistant", text: "noted" },
    ]);

    // A different generation/process: brand new instance over the same file.
    const reader = new PendingExtractionQueueStore(queuePath);
    const loaded = await reader.load();
    assert.equal(loaded.size, 1, "fresh instance must see the deposited session");
    const turns = loaded.get("agent:main:webchat:s1");
    assert.equal(turns.length, 2);
    assert.equal(turns[0].text, "remember the deploy window is Friday");
    assert.equal(turns[0].role, "user");
    assert.equal(turns[0].messageId, 1);
    assert.equal(turns[1].role, "assistant");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("remove retires only the consumed texts (restore-on-failure semantics)", async () => {
  const dir = makeDir();
  try {
    const queuePath = resolvePendingExtractionQueuePath(dir);
    const writer = new PendingExtractionQueueStore(queuePath);
    await writer.append("s1", [{ role: "user", text: "a" }, { role: "user", text: "b" }]);
    await writer.append("s2", [{ role: "user", text: "c" }]);

    const reader = new PendingExtractionQueueStore(queuePath);
    const removed = await reader.remove("s1", new Set(["a"]));
    assert.equal(removed, 1);

    const after = await new PendingExtractionQueueStore(queuePath).load();
    assert.deepEqual([...after.keys()].sort(), ["s1", "s2"]);
    assert.deepEqual(after.get("s1").map((t) => t.text), ["b"]);
    assert.deepEqual(after.get("s2").map((t) => t.text), ["c"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("queue file is capped by entry count", async () => {
  const dir = makeDir();
  try {
    const queuePath = resolvePendingExtractionQueuePath(dir);
    const store = new PendingExtractionQueueStore(queuePath, { maxEntries: 3 });
    for (const text of ["t1", "t2", "t3", "t4", "t5"]) {
      await store.append("s1", [{ role: "user", text }]);
    }
    const loaded = await new PendingExtractionQueueStore(queuePath).load();
    const texts = loaded.get("s1").map((t) => t.text);
    assert.deepEqual(texts, ["t3", "t4", "t5"], "oldest records must be dropped first");
    const lines = readFileSync(queuePath, "utf8").split("\n").filter(Boolean);
    assert.equal(lines.length, 3);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a missing queue file is not an error", async () => {
  const dir = makeDir();
  try {
    const store = new PendingExtractionQueueStore(resolvePendingExtractionQueuePath(dir));
    assert.equal((await store.load()).size, 0);
    assert.deepEqual(await store.size(), { entries: 0, bytes: 0 });
    assert.equal(await store.remove("s1", new Set(["a"])), 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
