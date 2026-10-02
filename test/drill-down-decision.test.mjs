import assert from "node:assert/strict";
import { test } from "node:test";

import jitiFactory from "jiti";

const jiti = jitiFactory(import.meta.url, { interopDefault: true });
const {
  DEFAULT_HIGH_CONFIDENCE_THRESHOLD,
  DEFAULT_LOW_CONFIDENCE_THRESHOLD,
  collectProvenanceRawBlockIds,
  decideDrillDown,
  formatDrillDownLog,
  matchesExactDetailRequest,
  matchesQuoteReference,
  matchesTimeReference,
} = jiti("../src/drill-down.ts");

function hit(overrides = {}) {
  return { id: "mem-1", score: 0.9, rawBlockIds: ["blk-1"], ...overrides };
}

test("sufficient summary hit does not drill into raw", () => {
  assert.deepEqual(decideDrillDown({ query: "what is my favourite editor", summaryHits: [hit()] }), {
    drill: false,
    reason: "summary-sufficient",
    mode: "none",
    rawBlockIds: [],
  });
});

test("explicit requests for the exact words or full detail drill deterministically", () => {
  for (const query of [
    "what were her exact words?",
    "give me the verbatim quote",
    "quote it word for word",
    "show me the full text",
    "告诉我原话",
    "我要看详细内容",
    "把完整记录发我",
    "他当时怎么说的？",
    "引用一下原文",
  ]) {
    const decision = decideDrillDown({ query, summaryHits: [hit()] });
    assert.equal(decision.drill, true, `must drill: ${query}`);
    assert.equal(decision.mode, "deterministic");
    assert.equal(decision.reason, "explicit-detail-request");
  }
});

test("a quote reference in the query drills deterministically", () => {
  for (const query of [
    'find where I said "the deploy is at six"',
    "search the note 「周五要上线」",
    "what did they mean by 『revert it』",
  ]) {
    const decision = decideDrillDown({ query, summaryHits: [hit()] });
    assert.equal(decision.drill, true, `must drill: ${query}`);
    assert.equal(decision.mode, "deterministic");
    assert.equal(decision.reason, "quote-reference");
  }
});

test("a time reference drills deterministically", () => {
  for (const query of [
    "what did we decide yesterday?",
    "what happened on 2026-10-01",
    "上次会议讲了什么",
    "我们什么时候说的",
  ]) {
    const decision = decideDrillDown({ query, summaryHits: [hit()] });
    assert.equal(decision.drill, true, `must drill: ${query}`);
    assert.equal(decision.mode, "deterministic");
    assert.equal(decision.reason, "time-reference");
  }
});

test("an empty summary hit drills deterministically with no provenance", () => {
  assert.deepEqual(decideDrillDown({ query: "anything about the roadmap", summaryHits: [] }), {
    drill: true,
    reason: "empty-summary",
    mode: "deterministic",
    rawBlockIds: [],
  });
  assert.equal(decideDrillDown({ query: "x", summaryHits: undefined }).reason, "empty-summary");
});

test("a low-confidence summary hit drills and carries its provenance link", () => {
  const decision = decideDrillDown({
    query: "roadmap notes",
    summaryHits: [hit({ score: DEFAULT_LOW_CONFIDENCE_THRESHOLD - 0.01, rawBlockIds: ["raw-1", "raw-2"] })],
  });
  assert.equal(decision.drill, true);
  assert.equal(decision.mode, "deterministic");
  assert.equal(decision.reason, "low-confidence-summary");
  assert.deepEqual(decision.rawBlockIds, ["raw-1", "raw-2"]);
});

test("a model may only be a fallback for the ambiguous band, never the sole gate", () => {
  const score = (DEFAULT_LOW_CONFIDENCE_THRESHOLD + DEFAULT_HIGH_CONFIDENCE_THRESHOLD) / 2;

  // No model available: deterministic-only behaviour keeps the summary.
  assert.deepEqual(decideDrillDown({ query: "roadmap", summaryHits: [hit({ score })] }), {
    drill: false,
    reason: "summary-sufficient",
    mode: "none",
    rawBlockIds: [],
  });

  // Model available: fallback may fire for the ambiguous band only.
  const withModel = decideDrillDown({
    query: "roadmap",
    summaryHits: [hit({ score })],
    modelFallbackAvailable: true,
  });
  assert.equal(withModel.drill, true);
  assert.equal(withModel.mode, "model");
  assert.equal(withModel.reason, "model-fallback");

  // A confident hit never reaches the model.
  const confident = decideDrillDown({
    query: "roadmap",
    summaryHits: [hit({ score: 0.95 })],
    modelFallbackAvailable: true,
  });
  assert.equal(confident.drill, false);
});

test("deterministic triggers win over the model fallback", () => {
  const decision = decideDrillDown({
    query: "quote the exact words",
    summaryHits: [hit({ score: 0.5 })],
    modelFallbackAvailable: true,
  });
  assert.equal(decision.mode, "deterministic");
  assert.equal(decision.reason, "explicit-detail-request");
});

test("no raw tier disables drilling entirely", () => {
  assert.deepEqual(decideDrillDown({ query: "原话", summaryHits: [], hasRawTier: false }), {
    drill: false,
    reason: "no-raw-tier",
    mode: "none",
    rawBlockIds: [],
  });
});

test("provenance collection de-duplicates across hits", () => {
  assert.deepEqual(
    collectProvenanceRawBlockIds([
      { rawBlockIds: ["a", "b"] },
      { rawBlockIds: ["b", "c"] },
      {},
    ]),
    ["a", "b", "c"],
  );
});

test("trigger matchers are individually addressable", () => {
  assert.equal(matchesExactDetailRequest("verbatim please"), true);
  assert.equal(matchesExactDetailRequest("summarise the roadmap"), false);
  assert.equal(matchesQuoteReference('they said "go"'), true);
  assert.equal(matchesTimeReference("last week"), true);
});

test("drill-down log line names the decision and budget", () => {
  const line = formatDrillDownLog(
    { drill: true, reason: "low-confidence-summary", mode: "deterministic", rawBlockIds: ["blk-1"] },
    { hitCount: 2, topScore: 0.2 },
  );
  assert.equal(
    line,
    "memory-lancedb-cip: drill-down drill=true mode=deterministic reason=low-confidence-summary hits=2 topScore=0.200 rawBlocks=[blk-1]",
  );
});
