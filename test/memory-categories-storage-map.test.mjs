import assert from "node:assert/strict";
import { describe, it } from "node:test";
import jitiFactory from "jiti";

const jiti = jitiFactory(import.meta.url, { interopDefault: true });
const {
  MEMORY_CATEGORIES,
  MEMORY_CATEGORY_ALIASES,
  ALWAYS_MERGE_CATEGORIES,
  MERGE_SUPPORTED_CATEGORIES,
  TEMPORAL_VERSIONED_CATEGORIES,
  APPEND_ONLY_CATEGORIES,
  DURABLE_CATEGORIES,
  FICTION_JUDGED_CATEGORIES,
  getStorageCategoryForMemoryCategory,
  resolveToolMemoryCategory,
  isToolMemoryCategoryError,
  normalizeCategory,
} = jiti("../src/memory-categories.ts");

// Single source of truth for the plan-B taxonomy: 10 canonical categories, one
// vocabulary, and an identity storage map (the canonical name IS what the
// storage `category` column holds). Every write path — SmartExtractor's
// mapToStoreCategory, the CLI/tool resolveToolMemoryCategory, and the
// reflection-mapped stamp — must agree with this table, and an unrecognized
// token must be rejected instead of silently falling back to patterns/other.

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

function setValues(set) {
  return [...set].sort();
}

describe("MEMORY_CATEGORIES (canonical list)", () => {
  it("is exactly the 10 canonical categories, in the documented order", () => {
    assert.deepEqual([...MEMORY_CATEGORIES], CANONICAL);
  });

  it("declares exactly the 5 singular/plural aliases", () => {
    assert.deepEqual({ ...MEMORY_CATEGORY_ALIASES }, ALIASES);
  });
});

describe("getStorageCategoryForMemoryCategory (identity storage map)", () => {
  it("maps every canonical category to itself", () => {
    for (const category of MEMORY_CATEGORIES) {
      assert.equal(
        getStorageCategoryForMemoryCategory(category),
        category,
        `unexpected storage category for "${category}"`,
      );
    }
  });

  it("agrees with resolveToolMemoryCategory's storageCategory for every canonical category", () => {
    // resolveToolMemoryCategory is the CLI/tool-facing consumer of the same
    // mapping; it must stay in lockstep with getStorageCategoryForMemoryCategory
    // (the extractor-facing consumer) for every category.
    for (const category of MEMORY_CATEGORIES) {
      const resolution = resolveToolMemoryCategory(category);
      assert.equal(isToolMemoryCategoryError(resolution), false, `"${category}" must resolve`);
      assert.equal(resolution.memoryCategory, category);
      assert.equal(resolution.storageCategory, getStorageCategoryForMemoryCategory(category));
    }
  });

  it("folds the 5 aliases onto their canonical name for both metadata and storage", () => {
    for (const [alias, canonical] of Object.entries(ALIASES)) {
      assert.equal(normalizeCategory(alias), canonical);
      const resolution = resolveToolMemoryCategory(alias);
      assert.equal(isToolMemoryCategoryError(resolution), false, `"${alias}" must resolve`);
      assert.equal(resolution.memoryCategory, canonical);
      assert.equal(resolution.storageCategory, canonical);
    }
  });
});

describe("unknown category is a typed validation error, never a silent fallback", () => {
  it("returns an invalid_memory_category error instead of patterns/other", () => {
    const resolution = resolveToolMemoryCategory("not-a-category");
    assert.equal(isToolMemoryCategoryError(resolution), true);
    assert.equal(resolution.error.code, "invalid_memory_category");
    assert.equal(resolution.error.rawCategory, "not-a-category");
    assert.ok(resolution.error.allowed.includes("fact"));
    assert.ok(resolution.error.allowed.includes("preference"));
    assert.equal(resolution.memoryCategory, undefined, "no fallback category may be produced");
    assert.equal(resolution.storageCategory, undefined, "no fallback storage value may be produced");
  });

  it("normalizeCategory returns null for unknown and empty input", () => {
    assert.equal(normalizeCategory("not-a-category"), null);
    assert.equal(normalizeCategory(""), null);
    assert.equal(normalizeCategory("   "), null);
  });
});

describe("behavior sets match the plan-B matrix", () => {
  it("profile is the only always-merge category", () => {
    assert.deepEqual(setValues(ALWAYS_MERGE_CATEGORIES), ["profile"]);
  });

  it("merge-supported categories", () => {
    assert.deepEqual(
      setValues(MERGE_SUPPORTED_CATEGORIES),
      ["entities", "fact", "patterns", "preferences", "reflection"],
    );
  });

  it("temporal-versioned categories (fact_key)", () => {
    assert.deepEqual(
      setValues(TEMPORAL_VERSIONED_CATEGORIES),
      ["entities", "fact", "preferences"],
    );
  });

  it("append-only categories", () => {
    assert.deepEqual(setValues(APPEND_ONLY_CATEGORIES), ["cases", "decision", "events"]);
  });

  it("every canonical category except \"other\" is durable", () => {
    assert.deepEqual(setValues(DURABLE_CATEGORIES), CANONICAL.filter((c) => c !== "other").sort());
  });

  it("only events is fiction-judged", () => {
    assert.deepEqual(setValues(FICTION_JUDGED_CATEGORIES), ["events"]);
  });

  it("append-only and merge-supported never overlap", () => {
    for (const category of APPEND_ONLY_CATEGORIES) {
      assert.equal(
        MERGE_SUPPORTED_CATEGORIES.has(category),
        false,
        `${category} must not be both append-only and merge-supported`,
      );
      assert.equal(ALWAYS_MERGE_CATEGORIES.has(category), false);
    }
  });

  it("temporal-versioned categories are a subset of the merge-supported set", () => {
    for (const category of TEMPORAL_VERSIONED_CATEGORIES) {
      assert.ok(MERGE_SUPPORTED_CATEGORIES.has(category), `${category} must support merge`);
      assert.ok(DURABLE_CATEGORIES.has(category), `${category} must be durable`);
    }
  });

  it("every behavior set only contains canonical categories", () => {
    for (const set of [
      ALWAYS_MERGE_CATEGORIES,
      MERGE_SUPPORTED_CATEGORIES,
      TEMPORAL_VERSIONED_CATEGORIES,
      APPEND_ONLY_CATEGORIES,
      DURABLE_CATEGORIES,
      FICTION_JUDGED_CATEGORIES,
    ]) {
      for (const category of set) {
        assert.ok(CANONICAL.includes(category), `${category} is not canonical`);
      }
    }
  });
});
