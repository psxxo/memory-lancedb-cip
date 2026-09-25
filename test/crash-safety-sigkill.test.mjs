/**
 * Crash safety: SIGKILL during a write must leave a readable store (v1.2.5)
 *
 * The user-visible failure was "the memory store looks hung/corrupt". These
 * tests take the harshest version of that — a process force-killed mid-import
 * with no chance to flush, release a lock or clean up — and assert the
 * invariants that make the difference between "stuck" and "safe":
 *   - the store reopens and serves data (no hang),
 *   - the data is complete rows only: either pre-crash or post-crash state,
 *     never a half-written row,
 *   - a lock left behind by the killed process can never cause a silent wait
 *     past the configured bound: it is either taken over automatically or the
 *     caller gets a readable error, and any long wait is logged.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import jitiFactory from "jiti";
import * as lancedb from "@lancedb/lancedb";

const jiti = jitiFactory(import.meta.url, { interopDefault: true });
const { MemoryStore, WRITE_LOCK_TIMEOUT_CODE } = jiti("../src/store.ts");

const REPO_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const STORE_PATH = join(REPO_ROOT, "src", "store.ts");
const JITI_BASE = `file://${join(REPO_ROOT, "crash-safety-probe.mjs")}`;

const TOTAL_ENTRIES = 240;
const KILL_AFTER = 60;

function runChild(script) {
  const child = spawn(
    process.execPath,
    ["--input-type=module", "-e", script],
    { cwd: REPO_ROOT, stdio: ["ignore", "pipe", "pipe"] },
  );

  let stdout = "";
  let stderr = "";
  const listeners = new Set();
  const emit = () => {
    for (const listener of [...listeners]) listener();
  };

  child.stdout.on("data", (chunk) => {
    stdout += chunk.toString();
    emit();
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
  });
  child.on("exit", emit);

  return {
    child,
    get stdout() {
      return stdout;
    },
    get stderr() {
      return stderr;
    },
    /** Resolve when `pattern` shows up on stdout. Unmatched waiters stay armed. */
    waitForLine(pattern, timeoutMs = 90_000) {
      return new Promise((resolve, reject) => {
        const check = () => {
          if (stdout.includes(pattern)) {
            clearTimeout(timer);
            listeners.delete(check);
            resolve();
          }
        };
        const timer = setTimeout(() => {
          listeners.delete(check);
          reject(new Error(
            `timed out waiting for ${pattern}; stdout=${stdout.slice(-400)} stderr=${stderr.slice(-400)}`,
          ));
        }, timeoutMs);
        listeners.add(check);
        check();
      });
    },
    /** Resolve when the child is gone; safe to call after it already exited. */
    waitForExit(timeoutMs = 90_000) {
      if (child.exitCode !== null || child.signalCode !== null) {
        return Promise.resolve({ code: child.exitCode, signal: child.signalCode });
      }
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("child did not exit")), timeoutMs);
        child.on("exit", (code, signal) => {
          clearTimeout(timer);
          resolve({ code, signal });
        });
      });
    },
  };
}

/**
 * list() intentionally returns `vector: []` for performance, so row integrity is
 * checked from the fields list() does return plus a raw LanceDB read for the
 * vectors themselves (assertVectorIntegrity).
 */
function assertCompleteRows(rows, label) {
  for (const row of rows) {
    assert.equal(typeof row.id, "string", `${label}: row id must be a string`);
    assert.ok(row.id.length > 0, `${label}: row id must be non-empty`);
    assert.match(String(row.text), /^(kill-probe|lock-probe)-/, `${label}: unexpected text ${row.text}`);
    assert.equal(row.scope, "global", `${label}: row must keep its scope`);
    assert.equal(row.category, "fact", `${label}: row must keep its category`);
    assert.ok(Number.isFinite(Number(row.importance)), `${label}: importance must be numeric`);
    assert.ok(
      Number.isFinite(Number(row.timestamp)) && Number(row.timestamp) > 0,
      `${label}: timestamp must be present (no half-written metadata)`,
    );
    assert.doesNotThrow(() => JSON.parse(row.metadata || "{}"), `${label}: metadata must be parseable JSON`);
  }
}

/** Prove the crash left no torn rows on disk: every stored vector is complete. */
async function assertVectorIntegrity(dir, expectedRows, label) {
  const rawDb = await lancedb.connect(dir);
  const rawTable = await rawDb.openTable("memories");
  const rawRows = await rawTable.query().limit(10_000).toArray();
  assert.equal(rawRows.length, expectedRows, `${label}: raw row count must match list()`);
  for (const row of rawRows) {
    assert.equal(Array.from(row.vector).length, 3, `${label}: vector for ${row.id} must be fully written`);
    assert.ok(Number.isFinite(Number(row.timestamp)) && Number(row.timestamp) > 0, `${label}: raw timestamp for ${row.id}`);
  }
  return rawRows.length;
}

function importScript(dir) {
  return `
import jitiFactory from "jiti";
const jiti = jitiFactory(${JSON.stringify(JITI_BASE)}, { interopDefault: true });
const { MemoryStore } = jiti(${JSON.stringify(STORE_PATH)});
const store = new MemoryStore({ dbPath: ${JSON.stringify(dir)}, vectorDim: 3 });
await store.ensureInitialized();
console.log("READY");
const TOTAL = ${TOTAL_ENTRIES};
for (let i = 0; i < TOTAL; i += 1) {
  await store.store({
    text: "kill-probe-" + i,
    vector: [0.1, 0.2, 0.3],
    category: "fact",
    scope: "global",
    importance: 0.5,
    metadata: "{}",
  });
  if ((i + 1) % 20 === 0) console.log("STORED " + (i + 1));
}
console.log("IMPORT_COMPLETE");
`;
}

function bulkWriteScript(dir) {
  return `
import jitiFactory from "jiti";
const jiti = jitiFactory(${JSON.stringify(JITI_BASE)}, { interopDefault: true });
const { MemoryStore } = jiti(${JSON.stringify(STORE_PATH)});
const store = new MemoryStore({ dbPath: ${JSON.stringify(dir)}, vectorDim: 3 });
await store.ensureInitialized();
const batch = [];
for (let i = 0; i < 6000; i += 1) {
  batch.push({
    text: "lock-probe-" + i,
    vector: [0.4, 0.5, 0.6],
    category: "fact",
    scope: "global",
    importance: 0.5,
    metadata: "{}",
  });
}
console.log("WRITE_STARTED");
await store.bulkStore(batch);
console.log("WRITE_DONE");
`;
}

/** Reproduce the artifact proper-lockfile leaves behind when its holder dies. */
function plantStaleLockArtifact(dir, ageMs = 0) {
  const lockTarget = join(dir, ".memory-write.lock");
  const lockArtifact = `${lockTarget}.lock`;
  writeFileSync(lockTarget, "");
  mkdirSync(lockArtifact, { recursive: true });
  if (ageMs > 0) {
    const when = new Date(Date.now() - ageMs);
    utimesSync(lockArtifact, when, when);
  }
  return lockArtifact;
}

describe("crash safety under SIGKILL", { concurrency: 1 }, () => {
  it("survives a SIGKILL mid-import: reopens, serves complete rows, and bounds any stale-lock wait", async () => {
    const dir = mkdtempSync(join(tmpdir(), "memory-lancedb-cip-sigkill-"));

    try {
      // ---------------------------------------------------------------- phase 1
      const run = runChild(importScript(dir));
      await run.waitForLine("READY");
      await run.waitForLine(`STORED ${KILL_AFTER}`);
      const killedAt = Date.now();
      run.child.kill("SIGKILL");
      const exit = await run.waitForExit();
      assert.ok(exit.signal === "SIGKILL" || exit.code !== 0, "child must die without a clean shutdown");
      assert.ok(
        !run.stdout.includes("IMPORT_COMPLETE"),
        "the import must be killed before it completes, otherwise this is not a crash test",
      );
      console.log(
        `  [sigkill] killed pid after ${run.stdout.match(/STORED (\d+)/g)?.length ?? 0} checkpoints; ` +
        `stdout tail=${JSON.stringify(run.stdout.slice(-60))}`,
      );

      // ---------------------------------------------------------------- phase 2
      const reopenStartedAt = Date.now();
      const recovered = new MemoryStore({ dbPath: dir, vectorDim: 3 });
      await recovered.ensureInitialized();
      const openMs = Date.now() - reopenStartedAt;
      const rows = await recovered.list(undefined, undefined, 10_000, 0);
      const listMs = Date.now() - reopenStartedAt - openMs;

      console.log(`  [sigkill] reopen ok in ${openMs}ms, listed ${rows.length} rows in ${listMs}ms`);

      assert.ok(openMs < 60_000, `reopen must not hang, took ${openMs}ms`);
      assert.ok(rows.length > 0, "rows committed before the kill must survive");
      assert.ok(
        rows.length <= TOTAL_ENTRIES,
        `crash cannot create rows out of thin air (got ${rows.length} > ${TOTAL_ENTRIES})`,
      );
      assertCompleteRows(rows, "post-sigkill read");
      await assertVectorIntegrity(dir, rows.length, "post-sigkill raw read");

      const uniqueIds = new Set(rows.map((row) => row.id));
      assert.strictEqual(uniqueIds.size, rows.length, "no duplicate rows after recovery");

      // The killed run wrote whole entries one at a time, so the surviving row
      // set must be a contiguous prefix of the import: "either old state or new
      // state", never an interleaved or half-written row.
      const expectedTexts = new Set(
        Array.from({ length: rows.length }, (_unused, index) => `kill-probe-${index}`),
      );
      assert.deepStrictEqual(
        new Set(rows.map((row) => row.text)),
        expectedTexts,
        `surviving rows must be exactly kill-probe-0..${rows.length - 1}, with no gaps or partial writes`,
      );
      console.log(`  [sigkill] integrity ok: ${rows.length} complete rows forming a contiguous prefix`);
      console.log(`  [sigkill] host-side wall clock: ${Date.now() - killedAt}ms since kill`);

      // ---------------------------------------------------------------- phase 3
      // Kill a second writer in the middle of a bulk write, which is where the
      // write lock is actually held, then prove the leftover artifact cannot
      // cause a silent over-budget wait.
      const run2 = runChild(bulkWriteScript(dir));
      await run2.waitForLine("WRITE_STARTED");
      // Let the 100ms batch accumulator flush and take the write lock, then kill
      // mid-chunk so the artifact really is the one a crashed writer leaves.
      await new Promise((resolve) => setTimeout(resolve, 150));
      run2.child.kill("SIGKILL");
      await run2.waitForExit();
      const killedMidWrite = !run2.stdout.includes("WRITE_DONE");

      const lockArtifact = join(dir, ".memory-write.lock.lock");
      const artifactExisted = existsSync(lockArtifact);
      console.log(
        `  [sigkill] second writer killed mid-write: ${killedMidWrite}; ` +
        `lock artifact left behind: ${artifactExisted ? "present" : "absent"}`,
      );

      const warnings = [];
      const originalWarn = console.warn;
      console.warn = (...args) => {
        warnings.push(args.map((value) => String(value)).join(" "));
      };
      const recoveryStartedAt = Date.now();
      const recovering = new MemoryStore({
        dbPath: dir,
        vectorDim: 3,
        writeLockTimeoutMs: 20_000,
        writeLockWarnAfterMs: 1_500,
      });
      let writeError = null;
      let wrote = null;
      try {
        wrote = await recovering.store({
          text: "kill-probe-recovery",
          vector: [0.7, 0.8, 0.9],
          category: "fact",
          scope: "global",
          importance: 0.5,
          metadata: "{}",
        });
      } catch (err) {
        writeError = err;
      } finally {
        console.warn = originalWarn;
      }
      const recoveryMs = Date.now() - recoveryStartedAt;

      console.log(
        `  [sigkill] post-crash write: ${writeError ? `failed with ${writeError.code ?? "no-code"}` : "succeeded"} ` +
        `in ${recoveryMs}ms after ${warnings.length} warning line(s)`,
      );
      if (writeError) {
        console.log(`  [sigkill] error detail: ${String(writeError.message).split("\n").slice(0, 4).join(" | ")}`);
      }

      // Envelope guarantee: either the stale lock is taken over, or the caller
      // gets a readable error inside the bound. Never a silent over-budget wait.
      assert.ok(recoveryMs < 25_000, `recovery must respect the bound, took ${recoveryMs}ms`);
      if (writeError) {
        assert.strictEqual(writeError.code, WRITE_LOCK_TIMEOUT_CODE);
        assert.match(writeError.message, /Recovery:/);
        assert.match(writeError.message, /\.memory-write\.lock/);
      } else {
        assert.ok(wrote?.id, "a successful recovery write must return the stored row");
      }
      if (recoveryMs > 1_500) {
        assert.ok(
          warnings.some((line) => line.includes("still waiting for the memory write lock")),
          `a wait over the warn threshold must be logged, got ${JSON.stringify(warnings)}`,
        );
      }

      // A legacy lock artifact survived the crash without corrupting the store:
      // the data written before the kill is still readable afterwards.
      const afterCrash = await recovering.list(undefined, undefined, 10_000, 0);
      assert.ok(afterCrash.length >= rows.length, "recovery must not lose previously committed rows");
      assertCompleteRows(afterCrash, "post-recovery read");
      await assertVectorIntegrity(dir, afterCrash.length, "post-recovery raw read");
      console.log(`  [sigkill] final row count after recovery: ${afterCrash.length}`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("reports a readable error (never a hang) when a live holder exceeds the bound", async () => {
    const dir = mkdtempSync(join(tmpdir(), "memory-lancedb-cip-sigkill-live-"));

    try {
      // A live holder is simulated by an artifact whose mtime stays fresh, so
      // staleness can never justify taking over the lock.
      const holder = new MemoryStore({ dbPath: dir, vectorDim: 3 });
      let releaseHolder;
      const held = Reflect.get(holder, "runWithFileLock").call(
        holder,
        () => new Promise((resolve) => {
          releaseHolder = resolve;
        }),
      );
      const ownerPath = join(dir, ".memory-write.lock.owner.json");
      const deadline = Date.now() + 5_000;
      while (!existsSync(ownerPath) && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      assert.strictEqual(existsSync(ownerPath), true, "holder must publish its owner hint");

      const store = new MemoryStore({
        dbPath: dir,
        vectorDim: 3,
        writeLockTimeoutMs: 1_500,
        writeLockWarnAfterMs: 300,
      });
      const startedAt = Date.now();
      await assert.rejects(
        () => store.store({
          text: "blocked-write",
          vector: [0.1, 0.2, 0.3],
          category: "fact",
          scope: "global",
          importance: 0.5,
          metadata: "{}",
        }),
        (err) => {
          assert.strictEqual(err.code, WRITE_LOCK_TIMEOUT_CODE);
          assert.match(err.message, /Timed out after/);
          assert.match(err.message, /Recovery:/);
          return true;
        },
      );
      const elapsedMs = Date.now() - startedAt;
      assert.ok(elapsedMs < 10_000, `bound must be respected, took ${elapsedMs}ms`);
      console.log(`  [bounded-wait] readable timeout after ${elapsedMs}ms (bound 1500ms)`);

      releaseHolder?.();
      await held.catch(() => {});
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("takes over the stale artifact a killed writer leaves behind, within the bound and with logs", async () => {
    const dir = mkdtempSync(join(tmpdir(), "memory-lancedb-cip-sigkill-stale-"));
    const writeLockTimeoutMs = 25_000;
    try {
      // No live holder. This is exactly the artifact a SIGKILLed writer leaves:
      // a proper-lockfile lock directory whose mtime stops advancing.
      const lockArtifact = plantStaleLockArtifact(dir);
      const store = new MemoryStore({
        dbPath: dir,
        vectorDim: 3,
        writeLockTimeoutMs,
        writeLockWarnAfterMs: 1_000,
      });

      const warnings = [];
      const originalWarn = console.warn;
      console.warn = (...args) => warnings.push(args.map((value) => String(value)).join(" "));
      const startedAt = Date.now();
      let stored = null;
      let error = null;
      try {
        stored = await store.store({
          text: "stale-lock-takeover",
          vector: [0.1, 0.2, 0.3],
          category: "fact",
          scope: "global",
          importance: 0.5,
          metadata: "{}",
        });
      } catch (err) {
        error = err;
      } finally {
        console.warn = originalWarn;
      }
      const elapsedMs = Date.now() - startedAt;

      console.log(
        `  [stale-lock] outcome=${error ? `${error.code || "no-code"}` : "taken over"} in ${elapsedMs}ms ` +
        `with ${warnings.length} warning line(s)`,
      );

      assert.ok(elapsedMs < writeLockTimeoutMs, `the bound must hold, took ${elapsedMs}ms`);
      assert.ok(
        warnings.some((line) => line.includes("still waiting for the memory write lock")),
        `a wait past the threshold must be logged, got ${JSON.stringify(warnings)}`,
      );
      assert.strictEqual(
        error,
        null,
        `a stale artifact must be taken over well inside the bound (25s bound vs a 10s staleness window), got: ${error?.message}`,
      );
      assert.ok(stored?.id, "the write must return the stored row");
      assert.strictEqual(existsSync(lockArtifact), false, "the stale artifact must be gone after takeover");

      const rows = await store.list(undefined, undefined, 10, 0);
      assert.strictEqual(rows.length, 1);
      assert.strictEqual(rows[0].text, "stale-lock-takeover");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("clears a long-stale artifact proactively and writes immediately", async () => {
    const dir = mkdtempSync(join(tmpdir(), "memory-lancedb-cip-sigkill-old-"));
    try {
      // Older than the 5-minute proactive threshold: recovery must not wait at all.
      const lockArtifact = plantStaleLockArtifact(dir, 6 * 60 * 1000);
      const store = new MemoryStore({
        dbPath: dir,
        vectorDim: 3,
        writeLockTimeoutMs: 5_000,
        writeLockWarnAfterMs: 1_000,
      });

      const warnings = [];
      const originalWarn = console.warn;
      console.warn = (...args) => warnings.push(args.map((value) => String(value)).join(" "));
      const startedAt = Date.now();
      let stored = null;
      try {
        stored = await store.store({
          text: "proactive-cleanup",
          vector: [0.1, 0.2, 0.3],
          category: "fact",
          scope: "global",
          importance: 0.5,
          metadata: "{}",
        });
      } finally {
        console.warn = originalWarn;
      }
      const elapsedMs = Date.now() - startedAt;

      console.log(`  [proactive-cleanup] stale artifact cleared, write completed in ${elapsedMs}ms`);

      assert.ok(stored?.id, "the write must succeed");
      assert.ok(elapsedMs < 5_000, `proactive cleanup must avoid the stale wait, took ${elapsedMs}ms`);
      assert.ok(
        warnings.some((line) => line.includes("cleared stale lock artifact")),
        `cleanup must be logged, got ${JSON.stringify(warnings)}`,
      );
      assert.strictEqual(existsSync(lockArtifact), false, "the stale artifact must be removed");

      const rows = await store.list(undefined, undefined, 10, 0);
      assert.strictEqual(rows.length, 1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
