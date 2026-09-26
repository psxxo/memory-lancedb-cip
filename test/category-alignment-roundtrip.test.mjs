// test/category-alignment-roundtrip.test.mjs
//
// Plan B: a single 10-category vocabulary. The canonical name IS what the
// storage `category` column holds, and the 5 singular/plural aliases are folded
// onto their canonical form before anything is persisted.
//
// This file proves the full CLI round trip for every canonical name and every
// alias:
//
//   import (JSON) -> stored row -> export (JSON) -> re-import
//
// with an identical canonical category at every hop, and that an unknown
// category name is rejected (row skipped, explicit warning) rather than
// silently becoming "other".

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import jitiFactory from "jiti";
import { Command } from "commander";

const jiti = jitiFactory(import.meta.url, { interopDefault: true });
const { MemoryStore } = jiti("../src/store.ts");
const { createMemoryCLI } = jiti("../cli.ts");

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
      getDefaultScope: () => "roundtrip-default",
      isAccessible: () => true,
      getAccessibleScopes: () => ["roundtrip-a", "roundtrip-b", "roundtrip-unknown"],
      getScopeFilter: () => ["roundtrip-a", "roundtrip-b", "roundtrip-unknown"],
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
  console.warn = (...parts) => logs.push(parts.join(" "));
  try {
    await program.parseAsync(["node", "openclaw", "memory-cip", ...args]);
  } finally {
    console.log = originalLog;
    console.error = originalError;
    console.warn = originalWarn;
  }
  return { logs: logs.join("\n"), errors: errors.join("\n") };
}

describe("category taxonomy round trip (import -> row -> export -> re-import)", () => {
  it("preserves the canonical category for all 10 names and all 5 aliases at every hop", async () => {
    const dir = mkdtempSync(join(tmpdir(), "category-roundtrip-"));
    try {
      const store = new MemoryStore({ dbPath: join(dir, "db"), vectorDim: VECTOR_DIM });
      const context = makeContext(store);

      const tokens = [...CANONICAL, ...Object.keys(ALIASES)];
      const expected = Object.fromEntries(tokens.map((token) => [token, ALIASES[token] ?? token]));

      // One import payload exercising every accepted token.
      const memories = tokens.map((token) => ({
        text: `roundtrip token "${token}" memory`,
        category: token,
      }));
      const importFile = join(dir, "import.json");
      writeFileSync(importFile, JSON.stringify({ version: "1.0", memories }, null, 2));

      await runCli(context, ["import", importFile, "--scope", "roundtrip-a"]);

      // Hop 1: the stored row carries the canonical name in the column.
      const rowsA = await store.list(["roundtrip-a"], undefined, 100, 0);
      assert.equal(rowsA.length, tokens.length, "every token must import");
      for (const memory of memories) {
        const row = rowsA.find((r) => r.text === memory.text);
        assert.ok(row, `missing stored row for token "${memory.category}"`);
        assert.equal(
          row.category,
          expected[memory.category],
          `token "${memory.category}" must persist as "${expected[memory.category]}"`,
        );
      }

      // Hop 2: export writes the canonical name back out.
      const exportFile = join(dir, "export.json");
      await runCli(context, ["export", "--scope", "roundtrip-a", "--output", exportFile]);
      const exported = JSON.parse(readFileSync(exportFile, "utf8"));
      assert.equal(exported.count, tokens.length);
      for (const memory of memories) {
        const row = exported.memories.find((m) => m.text === memory.text);
        assert.ok(row, `missing exported memory for token "${memory.category}"`);
        assert.equal(row.category, expected[memory.category]);
      }

      // Hop 3: re-importing the exported payload (ids stripped so it lands as a
      // fresh write in a fresh scope) yields the same canonical category.
      const reimportFile = join(dir, "reimport.json");
      writeFileSync(
        reimportFile,
        JSON.stringify(
          {
            version: exported.version,
            memories: exported.memories.map(({ id, ...rest }) => rest),
          },
          null,
          2,
        ),
      );

      await runCli(context, ["import", reimportFile, "--scope", "roundtrip-b"]);

      const rowsB = await store.list(["roundtrip-b"], undefined, 100, 0);
      assert.equal(rowsB.length, tokens.length, "every re-imported row must land");
      for (const memory of memories) {
        const row = rowsB.find((r) => r.text === memory.text);
        assert.ok(row, `missing re-imported row for token "${memory.category}"`);
        assert.equal(
          row.category,
          expected[memory.category],
          `re-imported token "${memory.category}" must still be "${expected[memory.category]}"`,
        );
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("rejects an unknown category name with an explicit warning instead of storing it as \"other\"", async () => {
    const dir = mkdtempSync(join(tmpdir(), "category-unknown-"));
    try {
      const store = new MemoryStore({ dbPath: join(dir, "db"), vectorDim: VECTOR_DIM });
      const context = makeContext(store);

      const importFile = join(dir, "import.json");
      writeFileSync(
        importFile,
        JSON.stringify({
          version: "1.0",
          memories: [
            { text: "known good row", category: "fact" },
            { text: "unknown token row", category: "bogus-category" },
          ],
        }),
      );

      const { logs } = await runCli(context, [
        "import",
        importFile,
        "--scope",
        "roundtrip-unknown",
      ]);

      assert.match(logs, /unknown category/i, "the skip must be explicit");
      assert.match(logs, /bogus-category/, "the warning must name the rejected value");

      const rows = await store.list(["roundtrip-unknown"], undefined, 100, 0);
      assert.deepEqual(
        rows.map((r) => r.text),
        ["known good row"],
        "the unknown-category row must not be stored",
      );
      assert.equal(
        rows.some((r) => r.category === "other"),
        false,
        "an unknown name must never silently become \"other\"",
      );
      const otherRows = await store.list(["roundtrip-unknown"], "other", 100, 0);
      assert.equal(otherRows.length, 0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
