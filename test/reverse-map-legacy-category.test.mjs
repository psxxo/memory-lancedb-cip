import assert from "node:assert/strict";
import Module from "node:module";
import { describe, it } from "node:test";
import jitiFactory from "jiti";

process.env.NODE_PATH = [
  process.env.NODE_PATH,
  "/opt/homebrew/lib/node_modules/openclaw/node_modules",
  "/opt/homebrew/lib/node_modules",
].filter(Boolean).join(":");
Module._initPaths();

const jiti = jitiFactory(import.meta.url, { interopDefault: true });
const { reverseMapLegacyCategory, parseSmartMetadata } = jiti("../src/smart-metadata.ts");

const MAPPED_ROW_TYPE = "memory-reflection-mapped";

describe("reverseMapLegacyCategory (single canonical vocabulary)", () => {
  it("reads every canonical column value back as itself", () => {
    for (const category of [
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
    ]) {
      assert.equal(reverseMapLegacyCategory(category, "any"), category);
    }
  });

  it("folds pre-migration aliases onto their canonical plural form", () => {
    assert.equal(reverseMapLegacyCategory("preference", "likes dark roast"), "preferences");
    assert.equal(reverseMapLegacyCategory("entity", "Acme Corp"), "entities");
    assert.equal(reverseMapLegacyCategory("event", "any"), "events");
    assert.equal(reverseMapLegacyCategory("case", "any"), "cases");
    assert.equal(reverseMapLegacyCategory("pattern", "any"), "patterns");
  });

  it("keeps decision and fact as first-class canonical categories (no lossy remap)", () => {
    // The old double layer mapped these onto events/profile/cases. Plan B makes
    // them canonical: a "decision" column row stays a decision, a "fact" column
    // row stays a fact, regardless of row text or row type.
    assert.equal(
      reverseMapLegacyCategory("decision", "Chose to use LanceDB over Qdrant for local dev"),
      "decision",
    );
    assert.equal(
      reverseMapLegacyCategory("decision", "Chose to use LanceDB over Qdrant", "some-other-type"),
      "decision",
    );
    assert.equal(
      reverseMapLegacyCategory("fact", "Runbook: restart the ingest worker when the queue backs up"),
      "fact",
    );
    assert.equal(
      reverseMapLegacyCategory("fact", "My name is Alex and I live in Berlin"),
      "fact",
    );
    // Reflection-mapped rows are no longer special-cased either: the column
    // holds the canonical name (cases for both lesson and decision lanes).
    assert.equal(
      reverseMapLegacyCategory("cases", "Chose to use LanceDB over Qdrant", MAPPED_ROW_TYPE),
      "cases",
    );
  });

  it("falls back to the non-durable \"other\" catch-all for unknown or absent values", () => {
    // Never to a durable category: a junk column must not be promoted by the
    // read path (the write path rejects unknown tokens outright).
    assert.equal(reverseMapLegacyCategory(undefined, "no category"), "other");
    assert.equal(reverseMapLegacyCategory("garbage-category", "any"), "other");
    assert.equal(reverseMapLegacyCategory("", "any"), "other");
  });
});

describe("default-layer parity between newly written and legacy-backed rows", () => {
  function layerOf(entry) {
    return parseSmartMetadata(entry.metadata, entry).memory_layer;
  }

  it("derives the same durable layer for a stamped mapped preferences row and an equivalent legacy-backed row", () => {
    const text = "Prefers dark roast coffee in the morning";
    const legacyBacked = { text, category: "preference", metadata: "{}" };
    const stampedMapped = {
      text,
      category: "preferences",
      metadata: JSON.stringify({
        type: MAPPED_ROW_TYPE,
        source: "reflection",
        mappedKind: "user-model",
        memory_category: "preferences",
      }),
    };
    assert.equal(layerOf(legacyBacked), "durable");
    assert.equal(layerOf(stampedMapped), "durable");
  });

  it("derives durable for an unstamped canonical preferences column via the identity read", () => {
    const entry = {
      text: "Prefers dark roast coffee in the morning",
      category: "preferences",
      metadata: "{}",
    };
    assert.equal(layerOf(entry), "durable");
  });

  it("keeps a junk stamp from hijacking layer derivation", () => {
    const entry = {
      text: "Prefers dark roast coffee in the morning",
      category: "preference",
      metadata: JSON.stringify({ memory_category: "not-a-real-category" }),
    };
    assert.equal(layerOf(entry), "durable");
  });

  it("derives the non-durable working layer for an unknown column with no stamp", () => {
    const entry = {
      text: "Some unclassifiable note",
      category: "garbage-category",
      metadata: "{}",
    };
    assert.equal(parseSmartMetadata(entry.metadata, entry).memory_category, "other");
    assert.equal(layerOf(entry), "working");
  });
});
