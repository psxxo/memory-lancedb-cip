# Raw-first memory storage (design note)

Recorded 2026-10-02 at the owner's direction. Decision model: raw_first_then_prune 0.90
(confidence 0.85) over the current extract-then-store 0.01; verbatim-by-default 0.79;
store_all_verbatim_then_label 0.81.

## The problem with extract-first

Today the plugin condenses queued conversation text with a model before storing it. That
makes the model call a precondition of storage, and the host only authorises a plugin model
call while a turn is live. Five releases (1.3.3-1.3.10) were spent working around that
authority boundary; three of them were disproved by measurement. On 2026-10-02 the turn-start
drain fired 26 times and reported 0 created every time, while the memories that did land came
from the scheduled sweep. Extraction is also lossy: when it finds nothing, nothing is stored,
and the source text is gone.

## The rule

**Verbatim first.** Conversation text is stored as-is, unconditionally, before any judgement
about its value. Condensation is a later, optional, non-destructive enrichment step.

1. Every turn's text is appended verbatim with metadata (timestamp, session key, agent,
   role, message id). Append-only: no rewrite, no summarise-in-place.
2. Nothing deletes raw text. Condensation produces *additional* entries (summary, tags,
   embedding, category) that reference the raw block. Removing an index entry never removes
   the block.
3. Special classes - emotional and personal material above all - are never condensed. This is
   not a per-class exception that a classifier has to detect: because detection itself needs a
   model, the default is verbatim for everything, and labelling is best-effort. A labelling
   failure degrades search, never content.
4. Idle-time jobs (the daily dreaming lane) may demote, tag or re-rank entries, and may build
   higher-level summaries. They must not delete raw text.
5. Retrieval prefers distilled entries when present and falls back to raw blocks otherwise.

## What this buys

Storage no longer depends on a live turn, a scheduled agent turn, the durable queue, or the
authority boundary - the whole fragile lane can be retired or reduced to an optional
enrichment job. Content stays complete, and context links survive because the raw blocks are
still there.

## What it costs (decision model: 2.69/4, leaning serious)

- disk and embedding volume on a 2 vCPU / 3.7GB host
- noisy recall: raw blocks are long and rank poorly against distilled entries unless the
  distilled layer exists
- larger privacy surface: raw text can contain anything
- a wrong condensation cannot corrupt content (it is additive), but it can distort ranking

## Migration

Existing distilled memories stay as they are. New turns begin writing raw blocks. The
extraction lane is demoted from precondition to enrichment; the 6-hourly sweep is kept only
if it is still needed to enrich idle sessions.

## How to verify (do not claim success without these)

- the store grows with raw blocks carrying session/timestamp metadata
- recall still returns sensible results, and falling back to raw works when no distilled
  entry exists
- no code path deletes or rewrites a raw block; digging for delete calls on the raw table
  returns only retention/maintenance paths that the owner has approved
- the disk delta over a day is measured and reported, not assumed
