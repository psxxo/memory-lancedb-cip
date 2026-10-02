# Extraction real-time lane (Plan A) — design freeze / status 2026-10-03

Owner decision: Plan A. The plugin-owned **direct** LLM lane is primary (real-time, at `agent_end`);
the host lanes (next-turn drain, 6h fallback cron) remain fallback.

## Verified facts (this repo @ 1.5.4)
- **The real-time trigger already exists.** `index.ts` `agent_end` splits on transport:
  `const usingHostTransport = ((config.llm?.transport ?? "direct") === "host")`. On the host lane it is
  queue-only (deposit into `pending-extraction-queue.jsonl`, drain later). On the **direct** lane it runs
  `smartExtractor.extractAndPersist(...)` **in-process, right after the turn**, and on failure calls
  `restoreConsumedCaptureState()` which puts the texts back into the durable queue for the fallback lanes.
  So no new trigger code is needed — the lane exists and is only switched off by the live config
  (`llm.transport: "host"`).
- **direct transport already exists** — `src/llm-client.ts`: `transport: "direct" | "host"`; "direct" posts
  straight to `llm.baseURL` / `llm.model` / `llm.apiKey`. No new client code.
- **The load-safety gate blocked the direct lane** — `src/load-safety.ts`
  `evaluateGenerationModelAvailability` checked the HOST model catalog for any explicit model, so a direct
  lane naming e.g. `qwen-flash` (absent from the DeepSeek-only host catalog) was `unavailable` → smart
  extraction **disabled at load**. Fixed: a new `pluginResolvesModel` input marks a direct lane whose
  `llm.baseURL` + `llm.apiKey` are configured as resolved by the plugin's own endpoint.
- **durable buffer already exists** — `src/extraction-queue.ts` → `<dataDir>/pending-extraction-queue.jsonl`
  (append-only + atomic rename, caps 2000 / 2 MB).

## Done (repo, not live)
- `0b92af2` — `src/extraction-queue.ts`: fsync on append and on the atomic rewrite; cap trims now reported
  through `onTrim` instead of silently dropping. Test `test/extraction-queue-durability.test.mjs` (3/3).
- `e6904ad` — `src/load-safety.ts` + `index.ts`: `pluginResolvesModel` gate input so the direct lane is not
  judged against the host catalog. Test `test/generation-model-gate.test.mjs` (3/3). `tsc` build green; dist
  rebuilt and committed for both.

## Remaining (live)
1. Config switch: `plugins.entries.memory-lancedb-cip.config.llm` →
   `transport: "direct"`, `model: "qwen-flash"`, `baseURL: "https://dashscope.aliyuncs.com/compatible-mode/v1"`,
   `apiKey: {source:"file", id:"/home/admin/.openclaw/.secrets/dashscope.key"}`, keep `timeoutMs: 60000`.
2. Install the new build (ClawHub publish + `plugins update`, or in-place copy) and **restart** — owner window
   (a restart drops sessions).
3. Verify: load line shows smartExtraction active on the direct lane; watch `extract-candidates` latency,
   token cost, and the pending queue draining; confirm rollback (transport back to host) is clean.

## Rollback
Set `llm.transport` back to `host` (queue-only + host lanes) — the code path is untouched and still there.

## Owner directive 2026-10-03: no built-in defaults
The component must contain **no default model id, key name, or key path**; every such value is a
configuration item, and when one is missing the component must **tell the host what to configure and what
kind of model is needed** instead of quietly substituting a default that misleads the host.
Landing it (`927bc08`):
- the hardcoded fallback embedding id (`text-embedding-3-small`, used at 7 sites in `index.ts` + 1 in
  `cli.ts`) is gone; an unconfigured embedding model now logs a loud, actionable notice
  (`set embedding.model to an OpenAI-compatible embeddings model id`) and reports as
  `(no embedding model configured)` in load-safety / logs;
- the host-default generation lane now **announces** that no `llm.model` is configured and the host default
  applies, rather than staying silent;
- the disabled-lane reason now names the required model TYPE (an OpenAI-compatible chat model that can
  return JSON), never a concrete id.
Guard: `test/no-hardcoded-model-defaults.test.mjs` (no default id in the entry files; unconfigured
generation model resolves to none; a direct lane with `baseURL`+`apiKey` is not host-catalog-gated).
Kept (adapter knowledge, not defaults, per the decision model): provider identifiers (`dashscope` rerank),
model-family detection (`/qwen3[-_]embedding/i`, `/qwen3|deepseek.*r1|qwq/i`), and the dims/context lookup
tables in `src/embedder.ts` / `src/chunker.ts`.

## Still open
- Which model + credential the owner wants on the direct lane (never assumed; must be configured).
- Install + restart window.
