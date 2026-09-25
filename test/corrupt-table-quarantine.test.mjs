/**
 * Corruption detection and opt-in quarantine (v1.2.5)
 *
 * The store must never discard data on the way out of a failure, so corruption
 * handling is deliberately asymmetric:
 *   - detection is NARROW: only "the table directory exists but holds no
 *     usable (non-empty) version manifest" counts — verified against real
 *     LanceDB behaviour, that shape cannot be opened OR rebuilt, and no
 *     transient failure can produce it;
 *   - the default action is to REFUSE (loudly) without touching the directory,
 *     so a transient open error can never move a healthy table;
 *   - the opt-in action renames to `memories.lance.corrupt-<UTC>`, preserving
 *     every byte, and then starts empty with a loud warning;
 *   - a table directory LanceDB can rebuild is left completely alone.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import jitiFactory from "jiti";

const jiti = jitiFactory(import.meta.url, { interopDefault: true });
const { MemoryStore, assessMemoryTableStructure } = jiti("../src/store.ts");

function makeDbPath() {
  return mkdtempSync(join(tmpdir(), "memory-lancedb-cip-corrupt-"));
}

function makeEntry(text) {
  return {
    text,
    vector: [0.1, 0.2, 0.3],
    category: "fact",
    scope: "global",
    importance: 0.5,
    metadata: "{}",
  };
}

/**
 * A table directory whose only version manifest is zero bytes long. Verified
 * against LanceDB: openTable AND createTable both fail on this shape, so it is
 * genuinely unopenable and unrebuildable.
 */
function makeCorruptTableDir() {
  const dir = makeDbPath();
  const tableDir = join(dir, "memories.lance");
  mkdirSync(join(tableDir, "_versions"), { recursive: true });
  mkdirSync(join(tableDir, "data"), { recursive: true });
  writeFileSync(join(tableDir, "_versions", "1.manifest"), ""); // zero bytes: unusable
  writeFileSync(join(tableDir, "data", "0000000000000000000000000000.lance"), "PRECIOUS-DATA");
  writeFileSync(join(tableDir, "SENTINEL.txt"), "do-not-delete-me");
  return { dir, tableDir };
}

/** A table directory with no version history at all — a shape LanceDB rebuilds. */
function makeRebuildableTableDir() {
  const dir = makeDbPath();
  const tableDir = join(dir, "memories.lance");
  mkdirSync(join(tableDir, "_versions"), { recursive: true });
  return { dir, tableDir };
}

function quarantineSiblings(dir) {
  return readdirSync(dir).filter((name) => name.startsWith("memories.lance.corrupt-"));
}

describe("structural corruption detection and quarantine", { concurrency: 1 }, () => {
  it("reports a healthy store as healthy", async () => {
    const dir = makeDbPath();
    try {
      const store = new MemoryStore({ dbPath: dir, vectorDim: 3 });
      await store.ensureInitialized();
      await store.store(makeEntry("healthy"));

      const assessment = assessMemoryTableStructure(dir);
      assert.strictEqual(assessment.tableDirExists, true);
      assert.strictEqual(assessment.versionsDirExists, true);
      assert.strictEqual(assessment.dataDirExists, true);
      assert.ok(assessment.manifestCount >= 1);
      assert.ok(assessment.usableManifestCount >= 1);
      assert.strictEqual(assessment.structurallyCorrupt, false);
      assert.match(assessment.detail, /healthy/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("flags a table directory with no usable manifest, and nothing else", async () => {
    const corrupt = makeCorruptTableDir();
    try {
      const assessment = assessMemoryTableStructure(corrupt.dir);
      assert.strictEqual(assessment.tableDirExists, true);
      assert.strictEqual(assessment.versionsDirExists, true);
      assert.strictEqual(assessment.manifestCount, 1, "the zero-byte file is still a manifest file");
      assert.strictEqual(assessment.usableManifestCount, 0);
      assert.strictEqual(assessment.latestManifest, null);
      assert.strictEqual(assessment.structurallyCorrupt, true);
      assert.match(assessment.detail, /no usable version manifest/);
      assert.strictEqual(existsSync(join(corrupt.tableDir, "SENTINEL.txt")), true, "detection is read-only");
    } finally {
      rmSync(corrupt.dir, { recursive: true, force: true });
    }

    // A brand-new / absent path is NOT corruption: first run must stay clean.
    const fresh = makeDbPath();
    try {
      const assessment = assessMemoryTableStructure(fresh);
      assert.strictEqual(assessment.tableDirExists, false);
      assert.strictEqual(assessment.structurallyCorrupt, false);
      assert.match(assessment.detail, /absent/);
    } finally {
      rmSync(fresh, { recursive: true, force: true });
    }
  });

  it("refuses to touch a corrupt table by default, failing with a readable error", async () => {
    const { dir, tableDir } = makeCorruptTableDir();
    try {
      const store = new MemoryStore({ dbPath: dir, vectorDim: 3 });

      await assert.rejects(
        () => store.ensureInitialized(),
        (err) => {
          assert.match(err.message, /Failed to open LanceDB store/);
          assert.match(err.message, /memory-cip doctor/);
          assert.match(err.message, /mv "/);
          assert.match(err.message, /no usable version manifest/);
          return true;
        },
      );

      assert.strictEqual(existsSync(join(tableDir, "SENTINEL.txt")), true, "no data may be deleted");
      assert.strictEqual(
        readFileSync(join(tableDir, "data", "0000000000000000000000000000.lance"), "utf8"),
        "PRECIOUS-DATA",
        "no data may be deleted",
      );
      assert.deepStrictEqual(quarantineSiblings(dir), [], "the default path must not rename anything");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("doctor reports the corruption, the recovery command, and still does not rename", async () => {
    const { dir, tableDir } = makeCorruptTableDir();
    try {
      const store = new MemoryStore({ dbPath: dir, vectorDim: 3 });
      const report = await store.diagnose();

      assert.strictEqual(report.lancedb.structurallyCorrupt, true);
      assert.strictEqual(report.lancedb.usableManifestCount, 0);
      assert.strictEqual(report.store.opened, false);
      assert.strictEqual(report.fts.available, false);
      assert.ok(
        report.warnings.some((warning) => warning.includes("structural corruption")),
        `expected a structural-corruption warning, got ${JSON.stringify(report.warnings)}`,
      );
      assert.ok(
        report.warnings.some((warning) => /mv "/.test(warning)),
        `expected a non-destructive recovery instruction, got ${JSON.stringify(report.warnings)}`,
      );
      assert.ok(
        report.warnings.some((warning) => warning.includes("store open/read failed")),
        "the failed open must be reported",
      );

      assert.strictEqual(existsSync(tableDir), true);
      assert.deepStrictEqual(quarantineSiblings(dir), [], "diagnose must be read-only");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("quarantines by rename when explicitly opted in, then starts empty without losing bytes", async () => {
    const { dir, tableDir } = makeCorruptTableDir();
    try {
      const store = new MemoryStore({ dbPath: dir, vectorDim: 3 });
      store.setCorruptQuarantine(true);

      const consoleErrors = [];
      const originalError = console.error;
      console.error = (...args) => {
        consoleErrors.push(args.map((value) => String(value)).join(" "));
      };
      try {
        await store.ensureInitialized();
      } finally {
        console.error = originalError;
      }

      const quarantined = quarantineSiblings(dir);
      assert.strictEqual(
        quarantined.length,
        1,
        `expected exactly one quarantine dir, got ${JSON.stringify(quarantined)}`,
      );
      const quarantinePath = join(dir, quarantined[0]);
      assert.match(
        quarantined[0],
        /^memories\.lance\.corrupt-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z$/,
        "quarantine name must carry a UTC timestamp",
      );

      // Every byte is still there, at the quarantine path.
      assert.strictEqual(
        existsSync(join(tableDir, "SENTINEL.txt")),
        false,
        "the corrupt directory was moved, not copied",
      );
      assert.strictEqual(existsSync(join(quarantinePath, "SENTINEL.txt")), true);
      assert.strictEqual(
        readFileSync(join(quarantinePath, "data", "0000000000000000000000000000.lance"), "utf8"),
        "PRECIOUS-DATA",
        "quarantine must preserve data verbatim",
      );
      assert.strictEqual(existsSync(join(quarantinePath, "_versions", "1.manifest")), true);

      // What now sits at the original path is a brand-new, healthy table.
      assert.ok(existsSync(join(tableDir, "_versions")), "a fresh table replaces the quarantined one");
      const afterQuarantine = assessMemoryTableStructure(dir);
      assert.strictEqual(afterQuarantine.structurallyCorrupt, false);
      assert.ok(afterQuarantine.usableManifestCount >= 1, "the replacement table must be healthy");

      // Loud, actionable warning.
      assert.ok(
        consoleErrors.some((line) => line.includes("STRUCTURAL CORRUPTION DETECTED")),
        `expected a loud banner, got ${JSON.stringify(consoleErrors)}`,
      );
      assert.ok(
        consoleErrors.some((line) => line.includes("NO DATA DELETED")),
        "the banner must state that no data was deleted",
      );
      assert.ok(
        consoleErrors.some((line) => line.includes("mv \"") && line.includes("memories.lance")),
        "the banner must include the restore command",
      );

      // It really is usable, starting from an empty store.
      const emptyRows = await store.list(undefined, undefined, 10, 0);
      assert.strictEqual(emptyRows.length, 0, "quarantine starts from an empty store");
      const stored = await store.store(makeEntry("after-quarantine"));
      assert.ok(stored.id);
      const rows = await store.list(undefined, undefined, 10, 0);
      assert.strictEqual(rows.length, 1);
      assert.strictEqual(rows[0].text, "after-quarantine");
      console.log(`  [quarantine] renamed to ${quarantined[0]} and started empty with ${rows.length} new row`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("honours MEMORY_LANCEDB_QUARANTINE_CORRUPT as the env opt-in", async () => {
    const { dir } = makeCorruptTableDir();
    const originalEnv = process.env.MEMORY_LANCEDB_QUARANTINE_CORRUPT;
    process.env.MEMORY_LANCEDB_QUARANTINE_CORRUPT = "1";
    try {
      const store = new MemoryStore({ dbPath: dir, vectorDim: 3 });
      const originalError = console.error;
      console.error = () => {};
      try {
        await store.ensureInitialized();
      } finally {
        console.error = originalError;
      }
      assert.strictEqual(quarantineSiblings(dir).length, 1);
    } finally {
      if (originalEnv === undefined) delete process.env.MEMORY_LANCEDB_QUARANTINE_CORRUPT;
      else process.env.MEMORY_LANCEDB_QUARANTINE_CORRUPT = originalEnv;
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("leaves a table directory LanceDB can rebuild completely alone", async () => {
    // No manifest at all, but no unreadable manifest either: verified that
    // LanceDB creates a fresh table here. Quarantining would be a false
    // positive, so nothing may be renamed even with the opt-in on.
    const { dir, tableDir } = makeRebuildableTableDir();
    try {
      const store = new MemoryStore({ dbPath: dir, vectorDim: 3 });
      store.setCorruptQuarantine(true);
      await store.ensureInitialized();
      await store.store(makeEntry("rebuilt"));

      assert.strictEqual(existsSync(tableDir), true, "the table directory must stay in place");
      assert.deepStrictEqual(quarantineSiblings(dir), []);
      const rows = await store.list(undefined, undefined, 10, 0);
      assert.strictEqual(rows.length, 1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("never quarantines a healthy store even when the opt-in is on", async () => {
    const dir = makeDbPath();
    try {
      const store = new MemoryStore({ dbPath: dir, vectorDim: 3 });
      store.setCorruptQuarantine(true);
      await store.ensureInitialized();
      await store.store(makeEntry("healthy-with-optin"));

      assert.deepStrictEqual(quarantineSiblings(dir), []);
      const reopened = new MemoryStore({ dbPath: dir, vectorDim: 3 });
      reopened.setCorruptQuarantine(true);
      await reopened.ensureInitialized();
      const rows = await reopened.list(undefined, undefined, 10, 0);
      assert.strictEqual(rows.length, 1);
      assert.strictEqual(rows[0].text, "healthy-with-optin");
      assert.deepStrictEqual(quarantineSiblings(dir), [], "a healthy reopen must never quarantine");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
