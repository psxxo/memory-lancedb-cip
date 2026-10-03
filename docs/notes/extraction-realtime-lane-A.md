# Extraction pipeline — architecture, triggers, runbook (Plan A)

Status: **LIVE** · plugin `memory-lancedb-cip` **1.6.0** · updated 2026-10-03.
Supersedes the earlier "design freeze / status" revision of this note (history at the bottom).
This is the canonical description: if the plugin changes, this file changes in the SAME release
(see `docs/release-checklist.md`).

## 1. What it is

Memory extraction turns finished conversation turns into durable memories. It is a three-trigger
pipeline with one durable buffer. The plugin-owned **direct LLM lane** is the primary path
(real-time, in-process at `agent_end`); the **host lanes** (next-turn drain, 6h fallback cron)
are the safety net. Owner decision: Plan A.

## 2. Live configuration (non-secret)

```
plugins.entries.memory-lancedb-cip.config.llm = {
  transport: "direct",
  model:     "deepseek-flash",
  baseURL:   "https://api.deepseek.com",
  apiKey:    { source: "store", provider: "default", id: "DEEPSEEK_API_KEY" },
  timeoutMs: 60000
}
```

- `model` is **not** a built-in default; it is configured (owner directive: no hardcoded model id,
  key name, or key path anywhere in the component).
- `apiKey` is a **shared-store SecretRef** — resolved lazily on first use and cached; if the store
  cannot resolve it the lane fails closed (`not resolved yet`) and stays in the queue.
- Startup line when healthy: `smart extraction enabled (LLM model: deepseek-flash, timeoutMs: 60000, noise bank: ON)`.

## 3. Architecture — three triggers, one buffer

| # | Trigger | Hook / driver | Scope | Notes |
|---|---------|---------------|-------|-------|
| 1 | **Inline at turn end** (primary) | `agent_end` auto-capture → `smartExtractor.extractAndPersist(...)` | the turn that just ended | Runs **only when the resolved transport is not "host"**. Real-time; no waiting for the next turn. |
| 2 | **Turn-start drain** (retry) | `before_agent_reply` → `decideTurnStartDrain(...)` | **the speaking session only** (`sessionKeyFilter`) | Drains texts that were deferred/restored. Throttled by `minIntervalMs`; skipped for a scheduled extraction turn. |
| 3 | **Fallback sweep** | managed cron `LanceDB Memory Extraction` (automation `1792cd49-1f36-444c-83c6-3f662087c1e0`, `0 */6 * * *` stagger 5m) → isolated agent turn calling the `memory_extract_pending` tool | **all sessions** (`drainingSessions=N`, no filter) | The only trigger that sweeps idle sessions. |

Buffer: `<dataDir>/pending-extraction-queue.jsonl` (`src/extraction-queue.ts`): append-only with
fsync + atomic rewrite, caps 2000 entries / 2 MB, cap trims reported via `onTrim`.

## 4. What goes to the queue vs. what is extracted inline

Both branches live in the `agent_end` auto-capture hook:

- **`usingHostTransport` true** (`resolveLlmTransport(config) === "host"`) → *queue only*:
  deposit the turn's texts, return. Extraction happens later (trigger 2 or 3).
- **`usingHostTransport` false** (direct lane) → *extract now*: noise filter by embedding, then
  `extractAndPersist(...)`. On failure `restoreConsumedCaptureState()` returns the consumed texts
  to the durable queue for the fallback lanes.
- **Barren run** (zero candidates) → texts are deferred into the queue so a later, richer batch can
  retry them. This is deliberate batching, not an error. Heartbeat turns replying `NO_REPLY` land here.

So the queue is **not** "everything waits for the next turn" — with the direct lane it holds only
(a) deferred barren material and (b) restored-on-failure material.

## 5. Transport resolution

`resolveLlmTransport(config)` returns `"direct" | "host"`:

1. explicit `config.llm.transport` wins if it is exactly `"direct"` or `"host"`;
2. otherwise, a fully configured direct lane (`model` + `baseURL` + `apiKey`) stays `"direct"`;
3. otherwise it follows the host default (`"host"`) where the host exposes its completion surface,
   else `"direct"` with no model of its own.

Consequence: **"follow the system default" and "real-time direct" are mutually exclusive** — the
host lane is queue-only at `agent_end`.

## 6. Verified live behaviour (2026-10-03, PID 110161)

- Hook topology confirmed in source: `agent_end` → `extractAndPersist` inline; queue on host/barren/failure.
- **After the direct lane went live (08:10): `turn-start extraction drain` events = 0**, while
  `smart-extractor: extracted N candidate(s)` runs continuously (5,1,4,4,4,2,3,2,3,4,3 …) with
  `[entities]`/`[other]` merges. ⇒ extraction completes **at the end of its own turn**, not at the
  next turn's start.
- The 12 queued entries observed at 09:22 were timestamped **06:09–06:20** (host-lane era, before the
  07:21 / 08:10 restarts); cleared by a manual trigger at 09:25 (12 → 0).
- Pre-restart failure signature `caller authority is no longer active` (post-turn host calls refused):
  **0 occurrences after the direct lane went live**.

## 7. Runbook

Inspect:
```sh
wc -l ~/.openclaw/memory/pending-extraction-queue.jsonl        # backlog size
journalctl --user -u openclaw-gateway --since '2 hours ago' | grep -E 'turn-start extraction drain|smart-extractor: (extracted|merged|no memories)|auto-capture queued'
```
Force a full sweep now (idempotent; use when a quiet session's tail must clear before the 6h cron):
```sh
openclaw cron run 1792cd49-1f36-444c-83c6-3f662087c1e0        # enqueues one all-session drain
```
Rollback to the host lane (queue-only, no plugin-owned credential):
set `llm.transport: "host"` and `plugins reload` (or restart).

## 8. Failure signatures

| Log | Meaning | Status |
|-----|---------|--------|
| `caller authority is no longer active` | host refused a post-turn LLM call | **fixed** by the direct lane (0 since 08:10) |
| `Async work scope is closed` | host handed a closed async scope to a deferred call | fixed in 1.3.3 (plugin-owned scope) |
| `smart-extractor: no memories extracted` | nothing worth extracting this run | benign; drains with `failed=0` |
| `restoring consumed texts for retry` | extraction failed; texts back in queue | transient; retried |

## 9. Owner directives carried by this design

- **No built-in defaults**: no default model id, key name, or key path in the component; missing
  config must *tell the host what to configure* (and the model TYPE), never substitute a default.
- **Unconfigured ⇒ follow the system default** (never a plugin-local model).
- **Docs ship in the same release** as the plugin change (`docs/release-checklist.md`).

## 10. History

- `0b92af2` queue fsync + `onTrim` reporting; `e6904ad` `pluginResolvesModel` gate;
  `927bc08` remove built-in defaults; `9c018ea` unconfigured ⇒ host default; `e1db274`/`f9e3236` docs.
- 1.3.3 scope fix; 1.3.4 direct fallback; 1.6.0 ships the direct lane, shared-store SecretRef
  support (`e115b1c`, `67d58c1`), and this note.
