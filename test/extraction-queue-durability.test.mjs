import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import jitiFactory from "jiti";

const jiti = jitiFactory(import.meta.url, { interopDefault: true });
const { PendingExtractionQueueStore } = jiti("../src/extraction-queue.ts");

function makeQueue(options = {}) {
  const dir = mkdtempSync(join(tmpdir(), "mlc-queue-"));
  const file = join(dir, "pending-extraction-queue.jsonl");
  return { store: new PendingExtractionQueueStore(file, options), dir, file };
}

describe("PendingExtractionQueueStore durability", () => {
  it("appends and loads turns grouped by session", async () => {
    const { store, dir } = makeQueue();
    try {
      await store.append("agent:main:main", [
        { role: "user", text: "hello" },
        { role: "assistant", text: "hi" },
      ]);
      await store.append("agent:other:main", [{ role: "user", text: "other" }]);
      const loaded = await store.load();
      assert.equal(loaded.get("agent:main:main").length, 2);
      assert.equal(loaded.get("agent:other:main").length, 1);
      const { entries, bytes } = await store.size();
      assert.equal(entries, 3);
      assert.ok(bytes > 0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("reports a trim when the entry cap drops the oldest records", async () => {
    const trims = [];
    const { store, dir } = makeQueue({ maxEntries: 3, onTrim: (i) => trims.push(i) });
    try {
      for (let i = 0; i < 5; i++) await store.append("s", [{ role: "user", text: "t" + i }]);
      const { entries } = await store.size();
      assert.equal(entries, 3);
      assert.ok(trims.length >= 1, "onTrim should fire");
      assert.equal(trims.reduce((n, t) => n + t.dropped, 0), 2);
      const loaded = await store.load();
      assert.deepEqual(loaded.get("s").map((t) => t.text), ["t2", "t3", "t4"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("remove retires only the consumed texts and keeps the file valid JSONL", async () => {
    const { store, dir, file } = makeQueue();
    try {
      await store.append("s", [
        { role: "user", text: "a" },
        { role: "user", text: "b" },
        { role: "user", text: "c" },
      ]);
      assert.equal(await store.remove("s", ["b"]), 1);
      const loaded = await store.load();
      assert.deepEqual(loaded.get("s").map((t) => t.text), ["a", "c"]);
      for (const line of readFileSync(file, "utf8").split("\n").filter(Boolean)) JSON.parse(line);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
