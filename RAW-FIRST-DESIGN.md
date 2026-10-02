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

## Two-tier recall (owner's design, 2026-10-02)

Human recall returns the condensed version first and produces rich detail only when detail is
asked for. The store mirrors that shape:

- **Summary tier - default recall.** Distilled entries: summary, tags, entities, embedding,
  each carrying a provenance link to the raw block it came from. Recall answers from this tier
  by default, because it is compact and high-signal.
- **Raw tier - detail on demand.** The verbatim blocks. Retrieved when detail is requested, or
  when the summary tier cannot answer, and always reachable through a summary's provenance
  link. This is the 100% fidelity copy.
- **Drill-down trigger: deterministic first, model last.** Explicit wording (asking for the
  exact words, a quote, or the full detail), a time or quote reference, or an empty or
  low-confidence summary hit triggers a raw fetch without involving a model. A model may be
  used only as a fallback, never as the sole gate: the 2026-10-02 lesson is that
  model-dependent steps are exactly where this system breaks (26 turn-start drains, 0 created).
- **Provenance is mandatory.** A distilled entry that cannot name its raw block is invalid.
  Without the link, drill-down is impossible and the summary silently becomes the only record.

Decision model: two-tier shape 1.00; deterministic-then-model drill trigger 0.86 (confidence 0.79).

## Storage layout (implemented 2026-10-02, v1.5.0)

The raw tier lives in the plugin data dir (`dirname(config.dbPath)`, the same directory as
`pending-extraction-queue.jsonl`):

- `raw-blocks.zst` — the concatenated, zstd-compressed payloads of every raw block, one
  independent compressed frame per block.
- `raw-blocks.index.jsonl` — one append-only metadata line per block: `id`, `sessionKey`,
  `agentId`, `role`, `timestamp`, `messageId`, and the block's `offset` + `length` (compressed
  bytes) and `rawLength` (uncompressed bytes).

Fetching one block reads exactly `[offset, offset+length)` and inflates it, so a single block
restores on its own in O(1) with no whole-archive dependency. Block ids are content-addressed
(SHA-1 over sessionKey + role + text, truncated), which makes agent_end redeliveries and terminal
flushes idempotent without any rewrite. There is deliberately no delete, rewrite or truncate path;
a crash between the blob write and the index append can only orphan bytes at the blob tail, which
the next append skips. The summary tier stores distilled entries in LanceDB as before, each
required to name the raw block ids it came from (`src/provenance.ts`); distilled never replaces raw.

### Codec

zstd from Node's built-in `node:zlib` (`zstdCompressSync` / `zstdDecompressSync`, verified present
on this host at Node v24.21.0). Chosen over gzip/brotli because it is a single call with no async
stream state per block, and it restores each block independently. `@types/node` 20 does not declare
the zstd members, so `src/raw-store.ts` accesses them through a small typed shim that fails loudly
if a host lacks them; the codec itself is unchanged.

### Measured compression ratio (real sample)

Measured 2026-10-02 on a real corpus: the 11 `workspace/memory/*.md` daily records, split into
message-sized paragraphs (327 blocks, avg 992 bytes, 324 KB raw):

- per block, as the store writes them: **1.42×** (29.4% smaller)
- whole corpus as one blob, for reference: 3.25× (69.2% smaller)

Per-block compression is lower than whole-corpus because each block is a short, independent frame
with no cross-block dictionary — that is the price of O(1) single-block restore, which the design
requires. Larger real message blocks compress better than the 992-byte average.

### Verified / not yet proven

- Verified by test: zstd round-trip of many blocks; restoring one block from its byte range while
  the archive bytes stay unchanged; a fresh instance reading another generation's blocks;
  idempotent re-append; no delete/rewrite API; provenance is mandatory; the deterministic
  drill-down triggers.
- Not yet proven on the real host: the disk delta over a day of live traffic (the design's own
  verification requirement), and the drill-down trigger mix / raw-detail injection in live recall.
  Both need a live turn to measure; do not claim them.

## 1.5.1: index compaction, trained dictionary, placement (measured 2026-10-02)

The 1.5.0 raw tier worked live, but two problems limited it and one placement was wrong.

### Storage layout (1.5.1)

Raw files now live in the plugin data dir itself - the directory that holds `memories.lance` -
not one level up:

- `raw-blocks.zst` - concatenated per-block zstd frames (the payload, unchanged idea).
- `raw-blocks.index.zst` - append-only framed index: a sequence of
  `[u32 little-endian frameLength][zstd frame]`, each frame one append batch of compact JSON with
  per-frame string tables (`{"s":[...],"a":[...],"dh":"<dictHash>","b":[[id,si,ai,rb,ts,o,l,n,mid],...]}`).
  Frames are compressed without a dictionary and are self-contained, so any plugin generation can
  append safely; a torn final frame reads short and is skipped while every earlier frame still
  loads. Fetching one block still reads exactly `[offset, offset+length)` - O(1), independent.
- `raw-blocks.dict.<hash>` + `raw-blocks.dict.current` - a trained zstd dictionary and its
  pointer. Each block records the dictionary hash it used, so retraining never breaks old blocks;
  a missing dictionary falls back to a plain frame.

The 1.5.0 files written one level up are migrated once on load into the data dir and left in place
(nothing deletes raw bytes).

### Codec

zstd level 19 via `node:zlib`, set through `params: { 100: 19 }` (ZSTD_c_compressionLevel).
Node's `zstdCompressSync` silently ignores its `level` option - all levels produce identical
frames - so the numeric parameter is required. `scripts/train-raw-dict.mjs` trains a dictionary on
this host's conversation text (live raw blocks by default; `--include-workspace` and
`--include-sessions` broaden it) using the `zstd` CLI, with a raw-content fallback when the CLI is
absent.

### Measured on the same 12-block live sample (9967 raw bytes)

The sample is the first 12 blocks 1.5.0 wrote: payload 7211 bytes and index 2362 bytes, net 9573
= 1.04x on disk. 1.5.1 (real implementation, not a model of it):

| variant | payload | index | net | net ratio |
| --- | --- | --- | --- | --- |
| 1.5.0 baseline (JSONL index, no dict) | 7211 | 2362 | 9573 | 1.04x |
| 1.5.1, no dictionary | 6742 | 400 | 7142 | 1.40x |
| 1.5.1, holdout dictionary (sample excluded from training) | 4691 | 410 | 5101 | **1.95x** |
| 1.5.1, dictionary trained on all host text incl. the sample | 3464 | 408 | 3872 | 2.57x |

Smaller samples (holdout dictionary): 1 block 0.17x, 3 blocks 0.51x, 6 blocks 1.94x, 12 blocks
1.95x. The index is the fixed cost that dominates tiny samples; the payload ratio is the content
ceiling. The dictionary itself is ~30-65 KB and is shared across the whole archive, so it must not
be counted against a single small sample - it amortizes over every block written while it is
current.

Honest read: the index target is met (2362 -> 410 bytes, 5.8x smaller; overhead 24% -> ~4%), and
the payload improves from 1.38x to 2.12x with a holdout dictionary. Net is 1.95x on this sample -
at 2x but not clearly above it. Cross-block redundancy is real (whole-stream level-19 compresses
the same corpus 2.13x, and a leave-one-out corpus dictionary reaches 2.3x payload), and only a
dictionary recovers it per block, but a 12-block sample gives a dictionary little prior context.
Net clearly above 2x (2.57x) is reached only when the dictionary has already seen the evaluated
text, which is not the honest generalization case.

### Provenance in the extraction lane

`extractAndPersist` now computes the raw block ids of the turns it read (the same
(sessionKey, role, text) hash the raw writer uses) and `bulkStoreAndValidate` merges them into
each created entry's metadata as `rawBlockIds`. Distilled rows therefore name their raw source
blocks; the reflection/mapped lane and merges of older rows are not stamped.

### Still unproven after 1.5.1

- The disk delta over a day of live traffic (the design's own requirement) - not measured.
- The live drill-down trigger mix and raw-detail injection - not observed live.
- The dictionary's steady-state benefit on a real growing archive - the 12-block sample is too
  small to show it; expect it to rise as the dictionary's conversation context grows.
