/**
 * Bounded, observable write-lock waits (v1.2.5)
 *
 * Guards the failure mode that made the store look "hung": a contended or
 * stale cross-process lock used to be absorbed by a ~151s exponential-backoff
 * budget with almost no output. These tests pin down that
 *   - the wait is bounded by a configurable deadline,
 *   - exceeding it throws a readable, recovery-carrying error (not a hang),
 *   - any wait past the warn threshold is logged, with lock path and a
 *     suspected holder pid,
 *   - the lock module is driven with a single attempt, so this module owns
 *     pacing and observability.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import jitiFactory from "jiti";

const jiti = jitiFactory(import.meta.url, { interopDefault: true });
const {
  MemoryStore,
  __setLockfileModuleForTests,
  WRITE_LOCK_TIMEOUT_CODE,
  WRITE_LOCK_OWNER_SUFFIX,
  resolveWriteLockTimeoutMs,
  resolveWriteLockWarnAfterMs,
  DEFAULT_WRITE_LOCK_TIMEOUT_MS,
} = jiti("../src/store.ts");

const runWithFileLock = (store, fn) => Reflect.get(store, "runWithFileLock").call(store, fn);

function makeDbPath() {
  return mkdtempSync(join(tmpdir(), "memory-lancedb-cip-lockwait-"));
}

function captureWarnings() {
  const lines = [];
  const original = console.warn;
  console.warn = (...args) => {
    lines.push(args.map((value) => (typeof value === "string" ? value : String(value))).join(" "));
  };
  return {
    lines,
    restore: () => {
      console.warn = original;
    },
  };
}

describe("write-lock wait bounds and observability", { concurrency: 1 }, () => {
  it("bounds the wait and throws a readable, recovery-carrying error", async () => {
    const dir = makeDbPath();
    const store = new MemoryStore({
      dbPath: dir,
      vectorDim: 3,
      writeLockTimeoutMs: 700,
      writeLockWarnAfterMs: 200,
    });

    let lockCallCount = 0;
    let sawSingleAttemptRetries = null;
    __setLockfileModuleForTests({
      lock: async (_lockPath, options = {}) => {
        lockCallCount += 1;
        sawSingleAttemptRetries = options.retries;
        throw Object.assign(new Error("Lock file is already being held"), { code: "ELOCKED" });
      },
    });

    const warnings = captureWarnings();
    const startedAt = Date.now();
    try {
      await assert.rejects(
        () => runWithFileLock(store, async () => "never"),
        (err) => {
          assert.strictEqual(err.code, WRITE_LOCK_TIMEOUT_CODE, "timeout must carry its own code");
          assert.match(err.message, /Timed out after/);
          assert.match(err.message, /\.memory-write\.lock/);
          assert.match(err.message, /storage\.writeLockTimeoutMs/);
          assert.match(err.message, /Recovery:/);
          assert.match(err.message, /No data was modified|wrote nothing/);
          return true;
        },
      );
    } finally {
      warnings.restore();
      __setLockfileModuleForTests(null);
    }
    const elapsedMs = Date.now() - startedAt;

    assert.ok(elapsedMs < 5_000, `wait must be bounded, took ${elapsedMs}ms`);
    assert.ok(lockCallCount > 1, "the bounded loop retries within the deadline");
    assert.strictEqual(sawSingleAttemptRetries, 0, "proper-lockfile must be driven one attempt at a time");
    assert.ok(warnings.lines.length >= 1, "a bounded wait must still be logged, not silent");
    assert.ok(
      warnings.lines.some((line) => line.includes("still waiting for the memory write lock")),
      `expected a progress warning, got: ${JSON.stringify(warnings.lines)}`,
    );
    rmSync(dir, { recursive: true, force: true });
  });

  it("returns immediately and stays silent when the lock is free", async () => {
    const dir = makeDbPath();
    const store = new MemoryStore({ dbPath: dir, vectorDim: 3, writeLockTimeoutMs: 5_000 });

    const warnings = captureWarnings();
    try {
      const value = await runWithFileLock(store, async () => "ok");
      assert.strictEqual(value, "ok");
    } finally {
      warnings.restore();
    }

    assert.deepStrictEqual(warnings.lines, [], "no contention means no warning lines");
    assert.strictEqual(
      existsSync(join(dir, `.memory-write.lock${WRITE_LOCK_OWNER_SUFFIX}`)),
      false,
      "the owner hint must be cleaned up after release",
    );
    rmSync(dir, { recursive: true, force: true });
  });

  it("reports the lock path, waited time and a suspected holder pid while waiting", async () => {
    const dir = makeDbPath();
    const holderConfig = { dbPath: dir, vectorDim: 3 };
    const waiterConfig = {
      dbPath: dir,
      vectorDim: 3,
      writeLockTimeoutMs: 2_500,
      writeLockWarnAfterMs: 300,
    };
    const holder = new MemoryStore(holderConfig);
    const waiter = new MemoryStore(waiterConfig);
    const ownerPath = join(dir, `.memory-write.lock${WRITE_LOCK_OWNER_SUFFIX}`);

    let releaseHolder;
    const holderDone = runWithFileLock(holder, async () => {
      await new Promise((resolve) => {
        releaseHolder = resolve;
      });
    });

    try {
      // Wait until the holder really owns the lock before contending.
      const ownershipDeadline = Date.now() + 5_000;
      while (!existsSync(ownerPath) && Date.now() < ownershipDeadline) {
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      assert.strictEqual(existsSync(ownerPath), true, "holder should publish an owner hint");

      const warnings = captureWarnings();
      let thrown;
      try {
        await runWithFileLock(waiter, async () => "should not run");
      } catch (err) {
        thrown = err;
      } finally {
        warnings.restore();
      }

      assert.ok(thrown, "waiter must fail rather than wait forever");
      assert.strictEqual(thrown.code, WRITE_LOCK_TIMEOUT_CODE);
      assert.ok(
        warnings.lines.some((line) => line.includes("still waiting for the memory write lock")),
        `expected a progress warning on stderr, got ${JSON.stringify(warnings.lines)}`,
      );
      assert.ok(
        warnings.lines.some((line) => /Suspected holder: pid=\d+/.test(line)),
        `progress warning must name a suspected holder pid, got ${JSON.stringify(warnings.lines)}`,
      );
      assert.ok(
        warnings.lines.some((line) => line.includes(".memory-write.lock")),
        "progress warning must name the lock path",
      );
      assert.match(thrown.message, new RegExp(`Suspected holder: pid=${process.pid}`));
      assert.match(thrown.message, /Recovery:/);
    } finally {
      releaseHolder?.();
      await holderDone.catch(() => {});
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("resolves the configured bound from config, env, and defaults", () => {
    const originalEnv = process.env.MEMORY_LANCEDB_WRITE_LOCK_TIMEOUT_MS;
    try {
      delete process.env.MEMORY_LANCEDB_WRITE_LOCK_TIMEOUT_MS;
      assert.strictEqual(resolveWriteLockTimeoutMs({}), DEFAULT_WRITE_LOCK_TIMEOUT_MS);
      assert.ok(DEFAULT_WRITE_LOCK_TIMEOUT_MS <= 30_000, "default must be far below the old ~151s budget");
      assert.strictEqual(resolveWriteLockTimeoutMs({ writeLockTimeoutMs: 12_345 }), 12_345);
      assert.strictEqual(resolveWriteLockTimeoutMs({ writeLockTimeoutMs: 1 }), 100, "clamped to the floor");
      assert.strictEqual(resolveWriteLockTimeoutMs({ writeLockTimeoutMs: 10 ** 9 }), 600_000, "clamped to the ceiling");

      process.env.MEMORY_LANCEDB_WRITE_LOCK_TIMEOUT_MS = "4321";
      assert.strictEqual(resolveWriteLockTimeoutMs({ writeLockTimeoutMs: 999 }), 4321, "env wins over config");

      delete process.env.MEMORY_LANCEDB_WRITE_LOCK_TIMEOUT_MS;
      assert.strictEqual(resolveWriteLockWarnAfterMs({}), 5_000);
      assert.strictEqual(resolveWriteLockWarnAfterMs({ writeLockWarnAfterMs: 250 }), 250);
    } finally {
      if (originalEnv === undefined) delete process.env.MEMORY_LANCEDB_WRITE_LOCK_TIMEOUT_MS;
      else process.env.MEMORY_LANCEDB_WRITE_LOCK_TIMEOUT_MS = originalEnv;
    }
  });

  it("publishes and cleans the owner hint around a held lock", async () => {
    const dir = makeDbPath();
    const store = new MemoryStore({ dbPath: dir, vectorDim: 3 });
    const ownerPath = join(dir, `.memory-write.lock${WRITE_LOCK_OWNER_SUFFIX}`);

    assert.strictEqual(existsSync(ownerPath), false);
    const seen = [];
    await runWithFileLock(store, async () => {
      seen.push(existsSync(ownerPath) ? JSON.parse(readFileSync(ownerPath, "utf8")) : null);
      return "done";
    });

    assert.ok(seen[0], "owner hint must exist while the lock is held");
    assert.strictEqual(seen[0].pid, process.pid);
    assert.ok(typeof seen[0].startedAt === "string" && seen[0].startedAt.length > 0);
    assert.strictEqual(existsSync(ownerPath), false, "owner hint must be removed on release");
    rmSync(dir, { recursive: true, force: true });
  });
});
