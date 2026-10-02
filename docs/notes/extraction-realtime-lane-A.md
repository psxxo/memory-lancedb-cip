# Extraction real-time lane (Plan A) — design freeze 2026-10-03

Owner decision: Plan A. Buffer pool = source of truth; a plugin-owned **direct** LLM lane is primary;
the host lanes (next-turn drain, 6h fallback cron) stay as fallback.

## Verified facts (from this repo @ 1.5.4)
- **direct transport already exists** — `src/llm-client.ts`: `transport?: "direct" | "host"`; "direct"
  posts straight to `llm.baseURL` / `llm.model` / `llm.apiKey` via the bundled OpenAI-compatible client.
  The live install only sets `transport: "host"`. So the own-model+own-credential lane needs **no new
  client code** — it is wiring + triggering.
- **durable buffer already exists** — `src/extraction-queue.ts` → `<dataDir>/pending-extraction-queue.jsonl`,
  append-only lines + atomic temp-file rename, caps 2000 entries / 2 MB (drops oldest), best-effort
  (errors swallowed). Entries are `{sessionKey, role, text, timestamp, messageId?}`.
- **drain implementation** — `index.ts runPendingExtractionForAgent()` merges the in-memory map with the
  durable file, dedupes, then `smartExtractor.extractAndPersist()`; on failure it keeps texts queued
  (restore-on-failure) and `pendingExtractionQueue.remove()` retires only the consumed texts.
- **current triggers** — only two: the `memory_extract_pending` tool (inside the scheduled cron turn) and
  the `turn_start` hook (next turn of the same session, line ~5711). There is **no immediate
  post-agent_end drain**, so an active session's turns wait for its next turn.
- **the real blocker** — the host authorizes a plugin completion only against the live run; a post-turn
  call is refused (`caller authority is no longer active`). A direct fetch has no such gate.

## Changes
1. `src/extraction-queue.ts` — durability: fsync the append and the atomic rewrite; keep the
   append-then-atomic-rewrite contract; make the caps configurable; when the cap forces a drop, log a
   warning and never drop entries that were never extracted (retain on overflow instead of silently
   discarding). Keep the per-instance serialize() chain; document the cross-process assumption.
2. LLM lane wiring (config, not code): `llm.transport: "direct"`, `llm.model`, `llm.baseURL`,
   `llm.apiKey: { source: "file", id: "<dashscope key>" }`. Default model `qwen-flash` (validated:
   6.3 s, 6255 tokens, JSON ok).
3. `index.ts` — add a post-`agent_end` immediate drain, gated by a new config flag
   (`extraction.realtime.enabled`, default **false**), bounded by the existing extraction rate limiter and
   one-in-flight-per-session; never awaited by the hook. Host lanes remain the fallback.
4. Failure semantics: unchanged — a failed direct call leaves the texts queued; the next-turn drain or the
   cron retries them through the host lane.
5. Rollback: set `llm.transport` back to `host` and/or `extraction.realtime.enabled: false`.

## Still open
- Default direct model (qwen-flash unless the owner picks otherwise).
- Install + restart window (owner path; restart drops sessions).
