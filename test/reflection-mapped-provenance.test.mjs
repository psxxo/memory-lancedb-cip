// Raw-block provenance propagation for the reflection mapped-row lane: every
// distilled row a SECONDARY create path mints must name the raw blocks it was
// read from, so drill-down can resolve them. The primary extraction lane
// already stamps this link (extractAndPersist); these tests pin the two
// bulkStoreAndValidate call sites inside
// SmartExtractor.persistGatedCandidates -- the main mapped-row create and the
// deferred-verdict follow-up create.
//
// Fixtures are entirely synthetic; no real conversation data.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import jitiFactory from "jiti";

const jiti = jitiFactory(import.meta.url, { interopDefault: true });
const { SmartExtractor, resolveExtractionProvenance } = jiti("../src/smart-extractor.ts");
const { parseRawBlockIdsFromMetadata } = jiti("../src/provenance.ts");

function vectorFor(text) {
  const vec = [];
  for (let d = 0; d < 16; d++) {
    const digest = createHash("sha256").update(`${text}:${d}`).digest();
    vec.push(((digest.readUInt32BE(0) % 2000) - 1000) / 1000);
  }
  return vec;
}

function makeEmbedder() {
  return {
    embed: async (text) => vectorFor(text),
    embedBatch: async (texts) => texts.map((t) => vectorFor(t)),
  };
}

function makeStore({ neighbors = [] } = {}) {
  const rows = new Map();
  for (const n of neighbors) rows.set(n.id, n);
  const updates = [];
  const bulkStored = [];
  return {
    rows,
    updates,
    bulkStored,
    async vectorSearch() {
      return [...rows.values()].map((entry) => ({ entry, score: 0.85 }));
    },
    async getById(id) {
      return rows.get(id) ?? null;
    },
    async update(id, patch) {
      updates.push({ id, patch });
      return rows.get(id) ?? null;
    },
    async store() {},
    async bulkStore(entries) {
      bulkStored.push(...entries);
      const stored = entries.map((e, i) => ({ ...e, id: `new-${rows.size + i + 1}`, timestamp: 1_700_000_500_000 }));
      for (const s of stored) rows.set(s.id, s);
      return stored;
    },
  };
}

function makeLlm({ onDedupBatch, onMergeBatch } = {}) {
  const calls = [];
  return {
    calls,
    async completeJson(prompt, label) {
      calls.push(label);
      if (label === "dedup-decision-batch") {
        if (!onDedupBatch) throw new Error("unexpected dedup-decision-batch call");
        return onDedupBatch(prompt);
      }
      if (label === "merge-memory-batch") {
        if (!onMergeBatch) throw new Error("unexpected merge-memory-batch call");
        return onMergeBatch(prompt);
      }
      throw new Error(`unexpected llm call: ${label}`);
    },
  };
}

function makeExtractor(store, llm, extraConfig = {}) {
  return new SmartExtractor(store, makeEmbedder(), llm, {
    user: "User",
    extractMinMessages: 1,
    extractMaxChars: 8000,
    defaultScope: "agent:probe",
    log() {},
    debugLog() {},
    ...extraConfig,
  });
}

function reflectionItem(text, { category = "patterns", heading = "Agent model deltas (about the assistant/system)", mappedKind } = {}) {
  const metadata = JSON.stringify({
    type: "memory-reflection-mapped",
    memory_category: category,
    _reflectionHeading: heading,
    ...(mappedKind ? { mappedKind } : {}),
    marker: "reflection-metadata-preserved",
  });
  return {
    candidate: { category, abstract: text, overview: `## ${heading}`, content: text },
    vector: vectorFor(text),
    buildEntry: (v) => ({
      text,
      vector: v,
      importance: 0.8,
      category,
      scope: "agent:probe",
      metadata,
    }),
  };
}

const SESSION_KEY = "refl-provenance";
const TURNS = [
  { role: "user", text: "Please rotate the staging credentials tonight." },
  { role: "assistant", text: "I will rotate them after the nightly deploy." },
  { role: "user", text: "Also confirm the failover runbook after every region switch." },
];
const EXPECTED_IDS = resolveExtractionProvenance(SESSION_KEY, TURNS);

describe("reflection mapped rows: raw-block provenance on every create path", () => {
  it("stamps rawBlockIds on rows created by the main mapped-row store path", async () => {
    assert.ok(EXPECTED_IDS.length >= 2, "fixture must yield a non-trivial provenance list");

    const store = makeStore({ neighbors: [] });
    const llm = makeLlm({});
    const extractor = makeExtractor(store, llm);

    const { createdEntries } = await extractor.persistGatedCandidates(
      [reflectionItem("Rotate the staging credentials tonight.")],
      {
        targetScope: "agent:probe",
        scopeFilter: ["agent:probe"],
        sessionKey: SESSION_KEY,
        conversationTurns: TURNS,
      },
    );

    assert.equal(createdEntries.length, 1, "the mapped row is created");
    assert.equal(store.bulkStored.length, 1, "bulkStore saw exactly one row");
    assert.deepEqual(
      parseRawBlockIdsFromMetadata(store.bulkStored[0].metadata),
      EXPECTED_IDS,
      "the created row must name its raw source blocks",
    );
    assert.deepEqual(
      parseRawBlockIdsFromMetadata(createdEntries[0].metadata),
      EXPECTED_IDS,
      "the returned entry must carry the same link",
    );
  });

  it("stamps rawBlockIds on rows created by the deferred-verdict follow-up path", async () => {
    const anchor = reflectionItem("Confirm the failover runbook after every region switch.");
    const restated = reflectionItem("After a region switch, always confirm the failover runbook.");
    restated.vector = [...anchor.vector];

    const store = makeStore({ neighbors: [] });
    // A throwing target read drives the deferred sibling verdict to its
    // fail-open create, which lands through the follow-up bulkStore path.
    store.getById = async () => {
      throw new Error("read outage");
    };
    const llm = makeLlm({
      onDedupBatch: () => ({
        results: [{ index: 1, decision: "support", match_index: 1, reason: "same practice restated" }],
      }),
    });
    const extractor = makeExtractor(store, llm);

    const { stats } = await extractor.persistGatedCandidates(
      [anchor, restated],
      {
        targetScope: "agent:probe",
        scopeFilter: ["agent:probe"],
        sessionKey: SESSION_KEY,
        conversationTurns: TURNS,
      },
    );

    assert.equal(stats.created, 2, "the deferred support read fails open to a follow-up create");
    assert.equal(store.bulkStored.length, 2, "the anchor and the follow-up row are both stored");
    for (const entry of store.bulkStored) {
      assert.deepEqual(
        parseRawBlockIdsFromMetadata(entry.metadata),
        EXPECTED_IDS,
        `row ${entry.id} must carry the raw-block link`,
      );
    }
  });

  it("omits rawBlockIds when the caller supplies no turns (legacy callers stay readable)", async () => {
    const store = makeStore({ neighbors: [] });
    const extractor = makeExtractor(store, makeLlm({}));

    await extractor.persistGatedCandidates(
      [reflectionItem("Rotate the staging credentials tonight.")],
      { targetScope: "agent:probe", scopeFilter: ["agent:probe"], sessionKey: SESSION_KEY },
    );

    assert.equal(store.bulkStored.length, 1);
    assert.deepEqual(parseRawBlockIdsFromMetadata(store.bulkStored[0].metadata), []);
  });
});
