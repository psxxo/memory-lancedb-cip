import assert from "node:assert/strict";
import { test } from "node:test";

import jitiFactory from "jiti";

const jiti = jitiFactory(import.meta.url, { interopDefault: true });
const {
  MissingProvenanceError,
  assertDistilledProvenance,
  hasDistilledProvenance,
  normalizeRawBlockIds,
  parseRawBlockIdsFromMetadata,
  validateDistilledProvenance,
  withProvenance,
} = jiti("../src/provenance.ts");

test("a distilled entry without provenance is invalid", () => {
  for (const entry of [
    undefined,
    null,
    "nope",
    [],
    { summary: "s", tags: ["t"] },
    { summary: "s", rawBlockIds: [] },
    { summary: "s", rawBlockIds: "  ,  " },
    { summary: "s", rawBlockIds: [null, 3, ""] },
  ]) {
    const validation = validateDistilledProvenance(entry);
    assert.equal(validation.valid, false, `invalid: ${JSON.stringify(entry)}`);
    assert.deepEqual(validation.rawBlockIds, []);
    assert.equal(hasDistilledProvenance(entry), false);
  }
});

test("provenance is accepted and normalized when it names real blocks", () => {
  const validation = validateDistilledProvenance({
    summary: "s",
    tags: ["deploy"],
    entities: ["Friday"],
    embedding: [0.1, 0.2],
    rawBlockIds: ["blk-a", "blk-b", "blk-a", "  blk-c  "],
  });
  assert.equal(validation.valid, true);
  assert.deepEqual(validation.rawBlockIds, ["blk-a", "blk-b", "blk-c"]);
});

test("asserting provenance throws for an unlinked distilled entry", () => {
  assert.throws(
    () => assertDistilledProvenance({ summary: "no link" }),
    (error) => {
      assert.ok(error instanceof MissingProvenanceError);
      assert.equal(error.reason, "empty-provenance");
      return true;
    },
  );
  assert.deepEqual(assertDistilledProvenance({ summary: "s", rawBlockIds: ["blk-1"] }), ["blk-1"]);
});

test("withProvenance stamps the link and refuses an empty one", () => {
  assert.deepEqual(withProvenance({ summary: "s" }, ["a", "b", "a"]), {
    summary: "s",
    rawBlockIds: ["a", "b"],
  });
  assert.throws(() => withProvenance({ summary: "s" }, []), MissingProvenanceError);
  assert.throws(() => withProvenance({ summary: "s" }, undefined), MissingProvenanceError);
});

test("a write boundary stores only distilled entries that carry provenance", () => {
  // Mirrors the summary-tier write boundary: the store callback must reject
  // an unlinked entry rather than persist it.
  const stored = [];
  const storeDistilled = (entry) => {
    assertDistilledProvenance(entry);
    stored.push(entry);
  };
  storeDistilled({ summary: "linked", rawBlockIds: ["blk-1"] });
  assert.throws(() => storeDistilled({ summary: "orphan" }), MissingProvenanceError);
  assert.equal(stored.length, 1, "only the linked entry may be stored");
  assert.equal(stored[0].summary, "linked");
});

test("normalizeRawBlockIds accepts comma strings, arrays and iterables", () => {
  assert.deepEqual(normalizeRawBlockIds("a, b ,a"), ["a", "b"]);
  assert.deepEqual(normalizeRawBlockIds(["a", "a", "b"]), ["a", "b"]);
  assert.deepEqual(normalizeRawBlockIds(new Set(["x", "y"])), []);
  assert.deepEqual(normalizeRawBlockIds(undefined), []);
});

test("parseRawBlockIdsFromMetadata reads the link from stored metadata", () => {
  assert.deepEqual(parseRawBlockIdsFromMetadata(JSON.stringify({ rawBlockIds: ["b1"] })), ["b1"]);
  assert.deepEqual(parseRawBlockIdsFromMetadata(JSON.stringify({ raw_block_ids: "b1,b2" })), ["b1", "b2"]);
  assert.deepEqual(parseRawBlockIdsFromMetadata(JSON.stringify({ provenance: ["p1"] })), ["p1"]);
  assert.deepEqual(parseRawBlockIdsFromMetadata("{}"), []);
  assert.deepEqual(parseRawBlockIdsFromMetadata("not json"), []);
  assert.deepEqual(parseRawBlockIdsFromMetadata(undefined), []);
});
