/**
 * Bounded, staged store open + `doctor` diagnostics (v1.2.5)
 *
 * A ~37s cold open used to be indistinguishable from a hang because nothing
 * was logged and the read path could queue behind index maintenance. These
 * tests pin down that
 *   - every open phase is logged with elapsed time,
 *   - opening an already-healthy store acquires NO write lock, so a read-only
 *     invocation can never block behind a writer,
 *   - the FTS catch-up fold is observable, bounded and can be switched off,
 *   - `diagnose()` reports dbPath, lock, rows, FTS and version-dir health.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import jitiFactory from "jiti";
import * as lancedb from "@lancedb/lancedb";

const jiti = jitiFactory(import.meta.url, { interopDefault: true });
const { MemoryStore, __setLockfileModuleForTests } = jiti("../src/store.ts");

function makeDbPath() {
  return mkdtempSync(join(tmpdir(), "memory-lancedb-cip-open-"));
}

function makeEntry(i, text = `open-probe-${i}`) {
  return {
    text,
    vector: [0.1 + i * 0.001, 0.2, 0.3],
    category: "fact",
    scope: "global",
    importance: 0.5,
    metadata: "{}",
  };
}

/**
 * Lifecycle diagnostics are written to stderr (stdout carries command output
 * and is parsed as data), so capture process.stderr.write for these assertions.
 */
function captureLogs() {
  const logs = [];
  const originalWrite = process.stderr.write.bind(process.stderr);
  process.stderr.write = (chunk, ...rest) => {
    logs.push(String(chunk));
    return originalWrite(chunk, ...rest);
  };
  return {
    logs,
    restore: () => {
      process.stderr.write = originalWrite;
    },
  };
}

describe("store open phases and doctor", { concurrency: 1 }, () => {
  it("logs each open phase with elapsed time on a fresh store", async () => {
    const dir = makeDbPath();
    const store = new MemoryStore({ dbPath: dir, vectorDim: 3 });

    const captured = captureLogs();
    try {
      await store.ensureInitialized();
    } finally {
      captured.restore();
    }

    const joined = captured.logs.join("\n");
    for (const fragment of [
      `opening store at "${dir}"`,
      "db opened in",
      'table "memories" opened',
      "FTS index missing; creating",
      "FTS index created in",
      "ready in",
    ]) {
      assert.ok(joined.includes(fragment), `expected open log to include ${JSON.stringify(fragment)}:\n${joined}`);
    }
    assert.match(joined, /ready in \d+(\.\d+)?m?s/, "ready line must carry elapsed time");

    // Lifecycle diagnostics must not pollute stdout: it is parsed as data.
    assert.strictEqual(existsSync(dir), true);
    rmSync(dir, { recursive: true, force: true });
  });

  it("keeps stdout clean: lifecycle diagnostics go to stderr only", async () => {
    const dir = makeDbPath();
    const store = new MemoryStore({ dbPath: dir, vectorDim: 3 });

    const capturedStdout = [];
    const originalWrite = process.stdout.write.bind(process.stdout);
    process.stdout.write = (chunk, ...rest) => {
      capturedStdout.push(String(chunk));
      return originalWrite(chunk, ...rest);
    };
    const captured = captureLogs();
    try {
      await store.ensureInitialized();
      await store.store(makeEntry(1, "stdout-clean-probe"));
    } finally {
      captured.restore();
      process.stdout.write = originalWrite;
    }

    assert.deepStrictEqual(
      capturedStdout,
      [],
      `stdout must stay empty for library calls (it is parsed as data), got: ${capturedStdout.join("")}`,
    );
    assert.ok(captured.logs.length > 0, "the same diagnostics must still be emitted, on stderr");
    assert.ok(captured.logs.join("\n").includes("ready in"));

    rmSync(dir, { recursive: true, force: true });
  });

  it("logs the open phases again, reporting a pre-existing FTS index", async () => {
    const dir = makeDbPath();
    const first = new MemoryStore({ dbPath: dir, vectorDim: 3 });
    await first.ensureInitialized();
    await first.store(makeEntry(1));

    const second = new MemoryStore({ dbPath: dir, vectorDim: 3 });
    const captured = captureLogs();
    try {
      await second.ensureInitialized();
    } finally {
      captured.restore();
    }

    const joined = captured.logs.join("\n");
    assert.ok(joined.includes("FTS index present in"), `expected FTS-present phase log:\n${joined}`);
    assert.ok(!joined.includes("FTS index missing; creating"), "an existing index must not re-create");
    assert.ok(joined.includes("ready in"), `expected ready line:\n${joined}`);

    rmSync(dir, { recursive: true, force: true });
  });

  it("takes no write lock when opening an already-initialized store", async () => {
    const dir = makeDbPath();
    const seed = new MemoryStore({ dbPath: dir, vectorDim: 3 });
    await seed.ensureInitialized();
    await seed.store(makeEntry(1, "steady-state-seed"));

    // Any write-lock acquisition during the reopen below would show up here.
    let lockAcquisitions = 0;
    __setLockfileModuleForTests({
      lock: async () => {
        lockAcquisitions += 1;
        return async () => {};
      },
    });

    try {
      const reopened = new MemoryStore({ dbPath: dir, vectorDim: 3 });
      await reopened.ensureInitialized();
      const rows = await reopened.list(undefined, undefined, 10, 0);
      assert.strictEqual(rows.length, 1);
      assert.strictEqual(
        lockAcquisitions,
        0,
        "a healthy reopen (the `memory-cip list` path) must not contend for the write lock",
      );
      assert.strictEqual(reopened.getFtsStatus().available, true);
    } finally {
      __setLockfileModuleForTests(null);
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("keeps reads responsive while an FTS backlog is pending, and logs the pending fold", async () => {
    const dir = makeDbPath();
    const seed = new MemoryStore({ dbPath: dir, vectorDim: 3 });
    await seed.ensureInitialized();

    // Raw writes bypass MemoryStore's own fold bookkeeping, so the reopened
    // instance sees a genuine unindexed backlog — exactly the cold-start shape
    // that used to block the read path.
    const rawDb = await lancedb.connect(dir);
    const rawTable = await rawDb.openTable("memories");
    const rows = [];
    for (let i = 0; i < 25; i += 1) {
      rows.push({
        id: `raw-${i}`,
        text: `raw backlog row ${i} zephyr`,
        vector: [0.11, 0.22, 0.33],
        category: "fact",
        scope: "global",
        importance: 0.5,
        timestamp: Date.now(),
        metadata: "{}",
      });
    }
    await rawTable.add(rows);

    const reopened = new MemoryStore({ dbPath: dir, vectorDim: 3 });
    const captured = captureLogs();
    let listMs = null;
    let listed = null;
    try {
      await reopened.ensureInitialized();
      const startedAt = Date.now();
      listed = await reopened.list(undefined, undefined, 100, 0);
      listMs = Date.now() - startedAt;
    } finally {
      captured.restore();
    }

    assert.ok(listed.length >= 25, `expected the raw rows to be readable, got ${listed.length}`);
    assert.ok(listMs < 15_000, `reads must not wait on index maintenance, took ${listMs}ms`);

    const joined = captured.logs.join("\n");
    assert.ok(
      joined.includes("unindexed rows; scheduling background catch-up fold"),
      `expected the pending fold to be logged:\n${joined}`,
    );
    assert.ok(
      joined.includes("reads are not blocked"),
      `the catch-up log must state that reads are unblocked:\n${joined}`,
    );

    rmSync(dir, { recursive: true, force: true });
  });

  it("skips the catch-up fold when storage.indexCatchUp is disabled", async () => {
    const dir = makeDbPath();
    const store = new MemoryStore({ dbPath: dir, vectorDim: 3, indexCatchUp: false });
    const captured = captureLogs();
    try {
      await store.ensureInitialized();
    } finally {
      captured.restore();
    }

    const joined = captured.logs.join("\n");
    assert.ok(joined.includes("FTS catch-up fold skipped"), `expected skip log:\n${joined}`);
    assert.ok(!joined.includes("scheduling background catch-up fold"));
    rmSync(dir, { recursive: true, force: true });
  });

  it("diagnose() reports dbPath, lock, rows, FTS and version-dir health", async () => {
    const dir = makeDbPath();
    const store = new MemoryStore({ dbPath: dir, vectorDim: 3, writeLockTimeoutMs: 12_345 });
    await store.ensureInitialized();
    await store.store(makeEntry(1, "doctor-probe"));

    const report = await store.diagnose();

    assert.strictEqual(report.dbPath, dir);
    assert.strictEqual(report.dbPathExists, true);
    assert.strictEqual(report.dbPathWritable, true);
    assert.strictEqual(report.writeLockTimeoutMs, 12_345);

    assert.strictEqual(report.lock.artifactExists, false, "no holder means no lock artifact");
    assert.strictEqual(report.lock.artifactAgeMs, null);
    assert.strictEqual(report.lock.stale, false);
    assert.match(report.lock.lockPath, /\.memory-write\.lock$/);
    assert.match(report.lock.hint, /Lock artifact:/);

    assert.strictEqual(report.store.opened, true);
    assert.strictEqual(report.store.tableExists, true);
    assert.strictEqual(report.store.rowCount, 1);
    assert.ok(report.store.initDurationMs >= 0);

    assert.strictEqual(report.fts.available, true);
    assert.strictEqual(report.fts.lastError, null);
    assert.ok(report.fts.indexName, "an FTS index should be reported");
    assert.ok(report.fts.indexCount >= 1);

    assert.strictEqual(report.lancedb.tableDirExists, true);
    assert.strictEqual(report.lancedb.versionsDirExists, true);
    assert.strictEqual(report.lancedb.dataDirExists, true);
    assert.strictEqual(report.lancedb.structurallyCorrupt, false);
    assert.ok(report.lancedb.manifestCount >= 1, "a healthy store has at least one version manifest");
    assert.match(report.lancedb.latestManifest, /\.manifest$/);
    assert.ok(existsSync(join(report.lancedb.tableDir, "_versions")));

    assert.deepStrictEqual(report.warnings, [], "healthy store should report no warnings");

    rmSync(dir, { recursive: true, force: true });
  });

  it("diagnose() stays useful when the store cannot be opened", async () => {
    const dir = makeDbPath();
    const store = new MemoryStore({ dbPath: join(dir, "missing-parent", "db"), vectorDim: 3 });
    const report = await store.diagnose();
    // store.diagnose must never throw or hang: a broken store is exactly when it is needed.
    assert.strictEqual(typeof report.dbPath, "string");
    assert.ok(Array.isArray(report.warnings));
    rmSync(dir, { recursive: true, force: true });
  });
});
