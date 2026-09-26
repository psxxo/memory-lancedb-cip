// test/import-category-policy.test.mjs
//
// Operator-controlled policy for UNKNOWN import category names.
//
// Nothing may ever be silently coerced: an unrecognized name either (a) matches
// an operator-supplied `--category-map` entry, or (b) is routed by the explicit
// `--unknown` policy — `reject` (default, skips the row with a warning listing
// the canonical names), `other`, or a canonical category. The dry-run previews
// the whole plan per row, and the tool path (`memory_store` / `memory_update`)
// keeps rejecting an unknown name with an error that names the valid values.
//
// Fixtures are synthetic; there is no live gateway and no network.
//
// Covers:
//   (a) --category-map resolves an arbitrary alias
//   (b) --unknown=other stores other explicitly
//   (c) --unknown=reject skips with a warning containing the canonical list
//   (d) default is reject
//   (e) dry-run shows the resolution plan
//   (f) unknown tool input surfaces an error naming the valid categories
// plus the --unknown=<canonical> route, an invalid --unknown value, and an
// invalid --category-map value (all fail loudly, never silently).

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import jitiFactory from "jiti";
import { Command } from "commander";

const jiti = jitiFactory(import.meta.url, { interopDefault: true });
const { MemoryStore } = jiti("../src/store.ts");
const { createMemoryCLI } = jiti("../cli.ts");
const { registerAllMemoryTools } = jiti("../src/tools.ts");

const VECTOR_DIM = 4;

const CANONICAL = [
  "profile",
  "preferences",
  "entities",
  "events",
  "cases",
  "patterns",
  "decision",
  "fact",
  "reflection",
  "other",
];

const ALIASES = {
  preference: "preferences",
  entity: "entities",
  event: "events",
  case: "cases",
  pattern: "patterns",
};

function vectorFor(text) {
  const digest = createHash("sha256").update(text).digest();
  const vec = [];
  for (let i = 0; i < VECTOR_DIM; i++) {
    vec.push((digest.readUInt32BE(i * 4) % 2000) / 1000);
  }
  return vec;
}

function makeContext(store) {
  return {
    store,
    retriever: {
      async retrieve() {
        return [];
      },
    },
    scopeManager: {
      getDefaultScope: () => "policy-default",
      isAccessible: () => true,
      getAccessibleScopes: () => ["policy-a"],
      getScopeFilter: () => ["policy-a"],
    },
    migrator: {},
    embedder: {
      async embedPassage(text) {
        return vectorFor(text);
      },
      async embedBatchPassage(texts) {
        return texts.map(vectorFor);
      },
    },
  };
}

async function runCli(context, args) {
  const program = new Command();
  program.exitOverride();
  createMemoryCLI(context)({ program });

  const logs = [];
  const errors = [];
  const originalLog = console.log;
  const originalError = console.error;
  const originalWarn = console.warn;
  console.log = (...parts) => logs.push(parts.join(" "));
  console.error = (...parts) => errors.push(parts.join(" "));
  // Warnings are part of the operator-facing contract here, so keep them in the
  // captured stream (a skipped row must be visible).
  console.warn = (...parts) => logs.push(parts.join(" "));
  // The CLI signals a policy/input error via process.exitCode; capture it and
  // restore the previous value so a non-zero code never leaks out and fails the
  // enclosing test file.
  const previousExitCode = process.exitCode;
  process.exitCode = undefined;
  let exitCode;
  try {
    await program.parseAsync(["node", "openclaw", "memory-cip", ...args]);
  } finally {
    exitCode = process.exitCode;
    process.exitCode = previousExitCode;
    console.log = originalLog;
    console.error = originalError;
    console.warn = originalWarn;
  }
  return { logs: logs.join("\n"), errors: errors.join("\n"), exitCode };
}

function writeImport(dir, name, memories) {
  const file = join(dir, name);
  writeFileSync(file, JSON.stringify({ version: "1.0", memories }, null, 2));
  return file;
}

function writeMap(dir, name, map) {
  const file = join(dir, name);
  writeFileSync(file, JSON.stringify(map, null, 2));
  return file;
}

function assertAllCanonicalListed(text, label) {
  for (const canonical of CANONICAL) {
    assert.ok(
      text.includes(canonical),
      `${label} must list the canonical category "${canonical}":\n${text}`,
    );
  }
}

describe("import category policy: --category-map and --unknown", () => {
  it("(a) --category-map resolves an arbitrary input name to a canonical category", async () => {
    const dir = mkdtempSync(join(tmpdir(), "category-map-"));
    try {
      const store = new MemoryStore({ dbPath: join(dir, "db"), vectorDim: VECTOR_DIM });
      const context = makeContext(store);
      const mapFile = writeMap(dir, "map.json", { lemmas: "cases", "my-thing": "preferences" });
      const importFile = writeImport(dir, "import.json", [
        { text: "mapped lemma row", category: "lemmas" },
        { text: "mapped dash row", category: "my-thing" },
      ]);

      const { logs } = await runCli(context, [
        "import",
        importFile,
        "--scope",
        "policy-a",
        "--category-map",
        mapFile,
      ]);

      assert.match(logs, /Import completed: 2 imported/, logs);
      const rows = await store.list(["policy-a"], undefined, 100, 0);
      assert.equal(rows.length, 2);
      assert.equal(rows.find((r) => r.text === "mapped lemma row")?.category, "cases");
      assert.equal(rows.find((r) => r.text === "mapped dash row")?.category, "preferences");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("(b) --unknown=other stores the row as other, explicitly and visibly", async () => {
    const dir = mkdtempSync(join(tmpdir(), "unknown-other-"));
    try {
      const store = new MemoryStore({ dbPath: join(dir, "db"), vectorDim: VECTOR_DIM });
      const context = makeContext(store);
      const importFile = writeImport(dir, "import.json", [
        { text: "unresolved row", category: "bogus-category" },
      ]);

      const { logs } = await runCli(context, [
        "import",
        importFile,
        "--scope",
        "policy-a",
        "--unknown",
        "other",
      ]);

      assert.match(logs, /Import completed: 1 imported/, logs);
      assert.match(
        logs,
        /unknown category "bogus-category" stored as "other" \(--unknown=other\)/,
        "the coercion must be announced, never silent",
      );

      const rows = await store.list(["policy-a"], undefined, 100, 0);
      assert.equal(rows.length, 1);
      assert.equal(rows[0].category, "other");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("(c) --unknown=reject skips the row with a warning that lists the canonical names", async () => {
    const dir = mkdtempSync(join(tmpdir(), "unknown-reject-"));
    try {
      const store = new MemoryStore({ dbPath: join(dir, "db"), vectorDim: VECTOR_DIM });
      const context = makeContext(store);
      const importFile = writeImport(dir, "import.json", [
        { text: "known row", category: "fact" },
        { text: "rejected row", category: "bogus-category" },
      ]);

      const { logs } = await runCli(context, [
        "import",
        importFile,
        "--scope",
        "policy-a",
        "--unknown",
        "reject",
      ]);

      assert.match(logs, /unknown category "bogus-category"/, logs);
      assert.match(logs, /row skipped/, logs);
      assert.match(logs, /--unknown=reject/, logs);
      assertAllCanonicalListed(logs, "the reject warning");

      const rows = await store.list(["policy-a"], undefined, 100, 0);
      assert.deepEqual(rows.map((r) => r.text), ["known row"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("(d) the default policy is reject", async () => {
    const dir = mkdtempSync(join(tmpdir(), "default-reject-"));
    try {
      const store = new MemoryStore({ dbPath: join(dir, "db"), vectorDim: VECTOR_DIM });
      const context = makeContext(store);
      const importFile = writeImport(dir, "import.json", [
        { text: "unresolved by default", category: "bogus-category" },
      ]);

      // No --unknown flag at all: reject is the documented default.
      const { logs } = await runCli(context, ["import", importFile, "--scope", "policy-a"]);

      assert.match(logs, /unknown category "bogus-category"/, logs);
      assert.match(logs, /--unknown=reject/, logs);

      const rows = await store.list(["policy-a"], undefined, 100, 0);
      assert.equal(rows.length, 0, "the reject default must store nothing");
      const otherRows = await store.list(["policy-a"], "other", 100, 0);
      assert.equal(otherRows.length, 0, "reject must never fall back to other");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("(e) dry-run prints the per-row resolution plan and stores nothing", async () => {
    const dir = mkdtempSync(join(tmpdir(), "dry-run-plan-"));
    try {
      const store = new MemoryStore({ dbPath: join(dir, "db"), vectorDim: VECTOR_DIM });
      const context = makeContext(store);
      const mapFile = writeMap(dir, "map.json", { lemmas: "cases" });
      const importFile = writeImport(dir, "import.json", [
        { text: "canonical row", category: "fact" },
        { text: "alias row", category: "entity" },
        { text: "mapped row", category: "lemmas" },
        { text: "rejected row", category: "bogus-category" },
        { text: "default row" },
      ]);

      const { logs } = await runCli(context, [
        "import",
        importFile,
        "--scope",
        "policy-a",
        "--category-map",
        mapFile,
        "--dry-run",
      ]);

      // Existing dry-run contract stays intact.
      assert.match(logs, /DRY RUN - No memories will be imported/);
      assert.match(logs, /Would import 5 memories/);
      assert.match(logs, /Target scope: policy-a/);

      // New: the resolution plan, per row.
      assert.match(logs, /Category resolution plan:/);
      assert.match(logs, /requested "fact" -> canonical -> fact/);
      assert.match(logs, /requested "entity" -> aliased -> entities/);
      assert.match(logs, /requested "lemmas" -> mapped by --category-map -> cases/);
      assert.match(logs, /requested "bogus-category" -> rejected/);
      assert.match(logs, /requested <none> -> default \(no category field\) -> other/);

      const rows = await store.list(["policy-a"], undefined, 100, 0);
      assert.equal(rows.length, 0, "a dry-run must not store anything");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("--unknown=<canonical> stores the unresolved row as that category", async () => {
    const dir = mkdtempSync(join(tmpdir(), "unknown-fact-"));
    try {
      const store = new MemoryStore({ dbPath: join(dir, "db"), vectorDim: VECTOR_DIM });
      const context = makeContext(store);
      const importFile = writeImport(dir, "import.json", [
        { text: "routed row", category: "not-a-category" },
      ]);

      const { logs } = await runCli(context, [
        "import",
        importFile,
        "--scope",
        "policy-a",
        "--unknown",
        "fact",
      ]);

      assert.match(logs, /stored as "fact" \(--unknown=fact\)/, logs);
      const rows = await store.list(["policy-a"], undefined, 100, 0);
      assert.equal(rows.length, 1);
      assert.equal(rows[0].category, "fact");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("rejects an unrecognized --unknown policy and an invalid --category-map value", async () => {
    const dir = mkdtempSync(join(tmpdir(), "policy-errors-"));
    try {
      const store = new MemoryStore({ dbPath: join(dir, "db"), vectorDim: VECTOR_DIM });
      const context = makeContext(store);
      const importFile = writeImport(dir, "import.json", [{ text: "row", category: "fact" }]);

      const badPolicy = await runCli(context, [
        "import",
        importFile,
        "--scope",
        "policy-a",
        "--unknown",
        "maybe",
      ]);
      assert.match(badPolicy.errors, /Unknown --unknown policy "maybe"/, badPolicy.errors);
      assert.equal(badPolicy.exitCode, 1, "a bad policy must fail the command");

      const badMapFile = writeMap(dir, "bad-map.json", { lemmas: "not-a-category" });
      const badMap = await runCli(context, [
        "import",
        importFile,
        "--scope",
        "policy-a",
        "--category-map",
        badMapFile,
      ]);
      assert.match(badMap.errors, /Invalid --category-map/, badMap.errors);
      assert.match(badMap.errors, /not-a-category/, badMap.errors);
      assert.equal(badMap.exitCode, 1, "an invalid category map must fail the command");

      const rows = await store.list(["policy-a"], undefined, 100, 0);
      assert.equal(rows.length, 0, "a policy error must import nothing");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("tool path: unknown category is still rejected with the valid values", () => {
  function createToolSet(context) {
    const creators = new Map();
    const api = {
      registerTool(factory, meta) {
        creators.set(meta.name, factory);
      },
      logger: { info() {}, warn() {}, debug() {} },
    };
    registerAllMemoryTools(api, context, { enableManagementTools: true });
    return {
      get(name) {
        const factory = creators.get(name);
        assert.ok(factory, `tool ${name} should be registered`);
        return factory({});
      },
    };
  }

  function makeToolContext() {
    const storedEntries = [];
    const context = {
      agentId: "main",
      workspaceDir: "/tmp",
      mdMirror: null,
      scopeManager: {
        getAccessibleScopes: (agentId) => ["global", `agent:${agentId}`],
        getScopeFilter: (agentId) => ["global", `agent:${agentId}`],
        isAccessible: (scope, agentId) => ["global", `agent:${agentId}`].includes(scope),
        getDefaultScope: (agentId) => `agent:${agentId}`,
      },
      retriever: {
        getConfig() {
          return { mode: "hybrid" };
        },
        async retrieve() {
          return [];
        },
      },
      embedder: {
        async embedPassage(text) {
          return vectorFor(text);
        },
      },
      store: {
        async vectorSearch() {
          return [];
        },
        async list() {
          return [];
        },
        async listFactKeyCandidates() {
          return [];
        },
        async store(entry) {
          const stored = { ...entry, id: `new-${storedEntries.length + 1}`, timestamp: Date.now() };
          storedEntries.push(stored);
          return stored;
        },
        async hasId() {
          return false;
        },
      },
    };
    return { context, storedEntries };
  }

  it("(f) memory_store surfaces an error naming the canonical categories and aliases", async () => {
    const { context, storedEntries } = makeToolContext();
    const store = createToolSet(context).get("memory_store");

    const res = await store.execute(null, {
      text: "a row with an unknown category",
      category: "bogus-category",
    });

    assert.equal(res.details.error, "invalid_memory_category");
    assert.equal(res.details.rawCategory, "bogus-category");

    const message = res.content[0].text;
    assert.match(message, /Invalid memory category "bogus-category"/, message);
    assertAllCanonicalListed(message, "the tool error");
    for (const alias of Object.keys(ALIASES)) {
      assert.ok(message.includes(alias), `the tool error must list the alias "${alias}":\n${message}`);
    }

    assert.equal(storedEntries.length, 0, "an unknown category must never be stored");
  });

  it("memory_update surfaces the same error naming the valid values", async () => {
    const { context, storedEntries } = makeToolContext();
    const update = createToolSet(context).get("memory_update");

    const res = await update.execute(null, { memoryId: "abc12345", category: "bogus-category" });

    assert.equal(res.details.error, "invalid_memory_category");
    const message = res.content[0].text;
    assert.match(message, /Invalid memory category "bogus-category"/, message);
    assertAllCanonicalListed(message, "the update error");
    assert.equal(storedEntries.length, 0);
  });
});
