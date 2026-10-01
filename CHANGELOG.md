## 1.3.4

**Post-turn completions: an authority refusal now retries on a plugin-owned fallback lane.**
1.3.3 removed the "Async work scope is closed" rejection by entering a fresh async work scope, but a
deferred call can still be refused once its turn has ended, because the host binds a completion's caller
authority to the live run (`AgentRunContext(runId) === context`, `hasCurrentClientAuthority()`); that
authority cannot be re-entered afterwards. When `llm.fallback` is configured, a host completion that
fails with an authority-expired signature ("async work scope is closed", "caller authority is no longer
active", "... no longer current", "... unavailable") is retried once over the plugin's own direct
transport. Every other failure keeps the previous behaviour, and the lane stays inert while
`llm.fallback` is unset.

- `src/llm-client.ts`: `isHostAuthorityExpiredError()`, `createConfiguredFallbackClient()` and
  `createAuthorityFallbackClient()`; the host client is wrapped only when a fallback is configured.
- `openclaw.plugin.json`: new `llm.fallback` object (`model` required; `apiKey`, `baseURL`, `auth`,
  `oauthPath`, `oauthProvider`, `timeoutMs`).
- `test/llm-host-work-scope.test.mjs`: three more cases — authority refusal retried on the fallback lane,
  unrelated host failures not retried, and no-fallback behaviour unchanged (29 pass / 0 fail).

## 1.3.3

**Deferred host-transport completions no longer die with `Async work scope is closed`.**
The host tracks `api.runtime.llm.complete` against whatever async work scope is live at call time
(`captureAsyncWorkTracker()` -> `scope.track(run)`), and `AsyncWorkScope.track` rejects once that scope
has closed. The extraction and dedup lanes run deferred — timers scheduled from inside a hook — so they
kept inheriting the finished turn's scope through AsyncLocalStorage, and every deferred host call failed
(measured: 33 failures/day, `llm-client [extract-candidates] host-transport request failed ... Async work
scope is closed`). Each host completion now runs inside a fresh, plugin-owned scope, loaded best-effort
from `openclaw/plugin-sdk/concurrency-runtime`; if that subpath is missing, or entering the scope throws,
the call runs exactly as before.

- `src/llm-client.ts`: `runInHostWorkScope()` wraps both host lanes (`completeJson`, `completeText`);
  `resetHostWorkScopeCacheForTests()` / `setHostWorkScopeCtorForTests()` expose the cache to tests.
- `test/llm-host-work-scope.test.mjs`: five cases — wrapped call, text lane, unavailable helper, missing
  subpath, throwing constructor.

## 1.3.2

**No built-in generation model any more: the LLM lane always follows the host default unless configured.**
`DEFAULT_GENERATION_MODEL` is gone from the code. It was the plugin's implicit fallback whenever
`llm.model` was unset, and it kept leaking into behaviour: the load-time availability gate confirmed
it against the host catalog, `memory-cip doctor` printed it, and the reflection lane fell back to it.
With this release an unset `llm.model` means the plugin names **no** model at all — the host
transport omits the field and OpenClaw's own default applies — and the manifest placeholder no longer
suggests one.

- `src/load-safety.ts`: the built-in default is removed. `resolveGenerationModel()` returns no model
  reference when nothing is configured; the availability gate passes on the host transport, reports
  "nothing to confirm" when no model is configured and the transport cannot resolve a default, and
  still fails closed when the host catalog is unreadable.
- `index.ts`: the generation client, the admission lane and the reflection completion fallback no
  longer substitute a built-in model; the load-safety report prints `host default`.
- `cli.ts` and the manifest: `memory-cip doctor` and the `llm.model` placeholder show
  `host default` instead of a built-in id.
- Tests: the effective-model default test now asserts *no* reference, the admission fixtures configure
  an explicit model, and the manifest-regression message no longer names a built-in.

Behaviour is unchanged for any deployment that sets `llm.model`: that value is still used verbatim.

## 1.3.1

**The LLM lane can follow the host's default model.** The plugin's generation model
(`llm.model`) was effectively always set: the manifest declared a JSON-schema default
(`openai/gpt-oss-120b`) and the OpenClaw host **materializes schema defaults into the plugin
config**, so an operator who left `llm.model` unset still got that value materialized — and on
the host transport the plugin then sent it as a model override, which the host rejects.

- **`llm.model` no longer declares a schema default.** Leave it unset and the host transport
  omits the model field entirely, so OpenClaw's own default model applies — one place to
  change when a provider renames a model. The standalone/direct fallback stays in code
  (`DEFAULT_GENERATION_MODEL`).
- **`llm.timeoutMs` no longer declares a schema default** either, so a materialized value can
  no longer shadow the 60000 ms code default (`resolveLlmTimeoutMs`).
- **The startup line reports what the lane will actually use** — an explicitly configured
  model, or `host default` when nothing is configured on the host transport.
- **The reflection completion fallback no longer disables itself** when `llm.model` is unset;
  it falls back to the built-in generation model (omitted on the host transport) like the
  other lanes.
- **The load-time availability gate understands the host-transport default.** With no
  `llm.model` configured and `llm.transport: "host"`, the gate no longer fails closed on the
  historical built-in default (`openai/gpt-oss-120b`) — the plugin is not choosing a model,
  so OpenClaw's own default applies and smart extraction stays on. An explicit `llm.model` is
  still gated exactly as before, and an unreadable catalog still fails closed.
- **`memory-cip doctor` reports `model=host default explicit=no`** for that state, with the
  reason spelled out.

## 1.3.0

**mdMirror resolves agent workspaces on the `agents.entries` config shape.** The Markdown
Mirror writer builds an agentId → workspace map to place each mirror file beside the agent
it belongs to (`<workspace>/memory/YYYY-MM-DD.md`). That map only understood the legacy
`agents.list` array, so on hosts using the current `agents.entries` map (for example
`agents.entries.main.workspace`) it came back empty: the plugin logged
`mdMirror: no agent workspaces found, writes will use fallback dir: …` and every agent's
mirror lines landed in one shared fallback directory.

- **`resolveAgentWorkspaceMap()` reads both config shapes.** It merges `agents.list`
  (legacy array) and `agents.entries` (per-agent map) from the runtime config, and applies
  the same merged reader to the `openclaw.json` fallback.
- **Entries win on conflict**, and entries without a usable string `workspace` are ignored.
- Behaviour is unchanged when the mirror is disabled, or when a resolvable workspace map is
  already present (the writer then logs `mdMirror: resolved N agent workspace(s)`).

## 1.2.9

**One-pass upgrades, longer LLM deadline.** Two changes driven by a real 892-row legacy
import into a live store.

- **`memory-cip upgrade` self-heals fallback rows.** When LLM enrichment fails for a row
  (most often a request timeout) the upgrader wrote the simple-truncation fallback and
  stopped there, so a second manual pass was needed. `upgrade()` now records those rows
  and retries them inside the same run, up to `retryFallbacks` extra passes (default 2;
  `0` disables; CLI `--retry-fallbacks <n>`). The summary reports
  `Fallback retried successfully: N` and lists any ids still falling back, so one command
  completes the work.
- **`llm.timeoutMs` default 30000 → 60000.** In the observed 139-row legacy batch, 4 rows
  exceeded the old 30 s deadline and fell back; long rows need more headroom. An explicit
  `llm.timeoutMs` in config still wins.

## 1.2.8

**Memory-runtime provenance contract.** The host excludes `MEMORY.md` / `USER.md` from the
automatic memory context unless the selected memory runtime can classify the provenance of
workspace memory paths. This release implements that contract.

- **`classifyWorkspaceMemoryPaths(params)`** on the memory capability runtime: returns
  `{ relativePath, originClass }` for every requested path, in order, and never throws
  (a per-path failure degrades to `untrusted`).
- **`supportsWorkspaceMemoryReadSources: true`**: accepted when the host resolves paths
  through restricted workspace read sources; classification is then driven only by the
  matching `canonicalRelativePath` (validated strictly; missing/invalid entry → `untrusted`).
- **Classification:** `USER.md` → `owner`; `MEMORY.md` / `memory.md` → `agent`;
  `memory/**` (daily notes, `memory/dreaming/**`, `.dreams`, short-term promotion) → `agent`;
  any other root file, unreadable path, path outside the workspace, or a non-normalized /
  absolute / backslash path → `untrusted` (unchanged safe behaviour).
- Effect: `MEMORY.md` / `USER.md` become eligible for automatic prompt injection and the
  host warning `excluding automatic memory context: selected memory runtime does not support
  provenance classification` disappears.

## 1.2.7

**Category taxonomy alignment — one vocabulary, no silent coercion.** The store no longer
keeps a two-layer category model. Ten canonical categories are the only vocabulary, the
storage column carries the canonical name verbatim, and an unrecognized name is rejected
instead of being silently rewritten.

- **Ten canonical categories:** `profile`, `preferences`, `entities`, `events`, `cases`,
  `patterns`, `decision`, `fact`, `reflection`, `other`. `decision`, `fact`, `reflection`
  and `other` were previously folded into other categories (fact→cases, decision→events,
  reflection/other→patterns) and are now first-class peers.
- **Identity storage mapping.** `getStorageCategoryForMemoryCategory` is the identity
  function, so `profile` and `cases` are no longer both stored as `fact` (a lossy
  collision that survived only in metadata).
- **Singular aliases stay accepted:** `preference→preferences`, `entity→entities`,
  `event→events`, `case→cases`, `pattern→patterns`.
- **Unknown names are rejected, never coerced.** `memory_store` / `memory_update` raise
  `InvalidMemoryCategoryError` naming the canonical categories and accepted aliases.
- **`import` gains an operator-controlled policy:** `--unknown reject|other|<canonical>`
  (default `reject`) and `--category-map <file>` for batch mapping; `--dry-run` prints a
  per-row resolution plan (requested → canonical / aliased / mapped / other / rejected).
- **Behavior matrix:** `profile` always merges; `preferences`, `entities`, `fact` merge and
  are temporal-versioned (fact key); `patterns`, `reflection` merge without a timeline;
  `events`, `cases`, `decision` are append-only; `other` is the non-durable catch-all.
- Docs: README (EN/CN plus the 9 translations), `docs/` and `skills/` updated to the
  single vocabulary.

## 1.2.6

**Behavior change — load-time safety.** A plugin installed into a host must never be
able to wedge it at load time. Two real incident root causes are now structurally
guarded: (1) a generation-LLM path that shipped ON by default with a model the host
did not have (`openai/gpt-oss-120b`) and a 30s timeout, repeatedly blocking the main
process, and (2) a load-time embedding warmup that issued network requests during
`register()`.

- **`smartExtraction` now defaults to `false` (opt-in).** This is a behavior change:
  upgrading hosts keep regex capture until they explicitly set `smartExtraction: true`.
  The old default shipped an LLM path that could block the main process on a model
  the host did not serve.
- **Generation-model availability gate with safe downgrade.** When smart extraction is
  enabled, the effective `llm.model` (or the built-in default) is resolved and checked
  against the HOST model inventory (`config.models.providers`, agent model bindings, and
  any host runtime model catalog). If the model cannot be confirmed available — absent
  from a confirmed catalog, provider missing, or the catalog unreadable — smart
  extraction is disabled and a loud, actionable warning/error is logged. The LLM is
  never called, and nothing hangs silently.
- **Zero network at load.** `register()` / `_initPluginState` are synchronous and make
  no outbound requests: the noise-prototype bank is now initialized lazily on first
  extraction (`NoisePrototypeBank.ensureInit`) instead of warming up at load. The
  `dist/` build ships this guarantee and `memory-cip doctor` reports it.
- **Bounded + observable load.** The synchronous load phase is timed and logged, warns
  when it exceeds `storage.loadWarnAfterMs` (default 2000ms), and reports the
  network-at-load conclusion.
- **`memory-cip doctor` additions.** Reports the embedding model/provider, the resolved
  generation LLM and whether it is available, whether smart extraction is actually
  active (with the reason when it is not), and the zero-network-at-load conclusion.

## 1.2.5

Hang-hardening: a stuck memory store can no longer look like a dead process, and
no failure path is allowed to discard data.

- **Bounded, observable write-lock waits.** The cross-process write lock now has a
  configurable ceiling (`storage.writeLockTimeoutMs` / `MEMORY_LANCEDB_WRITE_LOCK_TIMEOUT_MS`,
  default 30s) instead of the previous exponential-backoff budget that could stay
  silent for ~151s. Once a waiter passes `storage.writeLockWarnAfterMs` (default 5s)
  it logs the lock path, how long it has waited, a suspected holder pid/host from a
  sidecar hint file, and the recovery steps — repeated every 5s, so any wait over
  10s is guaranteed to be logged. On timeout the write fails with an
  `ELOCKWAITTIMEOUT` error naming the artifact and the exact fix, and this attempt
  writes nothing.
- **Bounded, staged store open.** `ensureInitialized()` now logs each phase
  (`opening store`, `db opened`, `table opened`, `FTS index present/created`,
  `ready in Xms`) with elapsed time, and the connect/table-open phase is bounded by
  `storage.openTimeoutMs` (default 120s) so an unresponsive filesystem surfaces as a
  readable error instead of an indefinite wait. The steady-state read path no longer
  takes the write lock at all: the FTS index is probed read-only and only a genuinely
  missing index pays for a lock.
- **Index/optimize maintenance is bounded and skippable.** The startup FTS catch-up
  fold stays off the read path, logs when it starts and finishes, is bounded by
  `storage.indexCatchUpTimeoutMs` (default 60s), and can be disabled entirely with
  `storage.indexCatchUp=false`.
- **New `memory-cip doctor` command** (with `--json`): reports dbPath existence and
  writability, write-lock artifact state and age, suspected holder, row/live counts,
  FTS/index state and unindexed backlog, LanceDB version-directory health, and
  actionable warnings.
- **Corruption is never silently destructive.** A structurally damaged
  `memories.lance` (table directory present with no version manifest) is detected and
  loudly reported. Quarantine is by rename only —
  `memories.lance.corrupt-<UTC>` — never deletion, and it is opt-in
  (`doctor --quarantine-corrupt`, `storage.quarantineCorruptTable`, or
  `MEMORY_LANCEDB_QUARANTINE_CORRUPT=1`) so a transient open failure can never move a
  healthy table; by default the store refuses to touch the directory and tells you
  what to do.
- **Crash-safety coverage.** New tests kill a process mid-`bulkStore` with `SIGKILL`
  and assert the reopened store reads cleanly with no half-written rows and no
  stale-lock hang, alongside coverage for lock-wait warnings/timeouts, staged open
  logs, `doctor` output, and non-blocking FTS catch-up.

## 1.2.4

CLI robustness fixes:

- `import <file>` now reports malformed import files in human-readable form
  (`Invalid import file: expected {"version": number, "memories": [{ "text": string, ... }]}`)
  and exits non-zero instead of printing a stack trace. Invalid array entries are skipped
  with a per-index note.
- `import-markdown` accepts an explicit Markdown file path in addition to a workspace glob.
- Generated inspector reports are no longer tracked in the repository.

## 1.2.3

Published as `@psxxo/lancedb-cip` (the previously used `@psxxo/lancedb-cip` name is soft-deleted on ClawHub).

Fixes two host-integration defects:

- **CLI metadata no longer touches plugin runtime.** `openclaw --help` / `openclaw plugins list` no longer emit `smart extraction init failed ... runtime is intentionally unavailable during "cli-metadata" registration`. The root command is now declared in the manifest (`cliCommands`) and `register()` returns before singleton init in `cli-metadata` mode; `runtime.llm` probing is defensive.
- **No more `plugin tool name conflict (memory-core)` warnings.** The `memory_search` / `memory_get` compatibility aliases are registered only while those names are still free, so they never collide with the memory tools already provided by the built-in memory runtime (no ambiguous or fragmented memory surface) and they still exist on hosts with no alternative provider.

## 1.2.2

Zero-trace rename — the legacy `pro` token no longer appears anywhere in the tree (source, docs, tests, CI, manifest, compiled `dist/`).

- CLI command namespace is now `memory-cip` (the host routing declaration, every log/error prefix, the docs and the tests all follow it).
- Plugin manifest `id` is `memory-lancedb-cip` (the old ClawHub-locked id is gone).
- Env vars use the new forms: `MEMORY_CIP_OAUTH_*` and `MEMORY_LANCEDB_CIP_DB_PATH`.
- The governance tool is now `memory_promote` (label "Memory Promote").
- Upstream repository / release / setup-script / skill URLs and their install sections removed; the npm badge, issues and contributors links now point at this fork.
- Attribution reduced to one credit line per README; `LICENSE` unchanged (MIT, original copyright text intact).
- `dist/` regenerated from the renamed sources.

## 1.2.0

Full rename to **Memory LanceDB CIP** (`memory-lancedb-cip`):

- Plugin id and display name: `memory-lancedb-cip` / "Memory (LanceDB CIP)".
- Default data path: `~/.openclaw/memory/lancedb-cip`.
- Docs, log/error prefixes, hook registration ids, CLI namespace (`memory-cip`), env vars (`MEMORY_CIP_*`), CLI docs and tests follow the new naming.
- Attribution to the MIT-licensed original project by win4r (CortexReach) is preserved in READMEs and changelogs.
- No install migration: there is no installed base that uses the previous id/path.

## 1.1.0-beta.11 (OpenClaw 2026.5 runtime compatibility)

- Ship compiled `dist/index.js` runtime and point package/OpenClaw extension entries at it.
- Declare `contracts.tools` for registered agent tools.
- Avoid double-resolving already-absolute backup/admission audit paths.
- Load LanceDB via ESM dynamic `import()` instead of `require()`.

# Changelog

## Unreleased

### Fix: cumulative turn counting for auto-capture smart extraction (#417, PR #549)

**Bug**: With `extractMinMessages: 2` + `smartExtraction: true`, single-turn DM conversations always fell through to regex fallback, writing dirty data (`l0_abstract == text`, no LLM distillation).

**Root causes**:
- `autoCaptureSeenTextCount` was overwritten per-event (always 1 for DM), never accumulating
- `buildAutoCaptureConversationKeyFromIngress` returned `null` for DM (no `conversationId`), so `pendingIngressTexts` was never written

**Changes**:
- **Cumulative counting**: `autoCaptureSeenTextCount` now accumulates across events instead of overwriting per-event
- **DM key fallback**: `buildAutoCaptureConversationKeyFromIngress` falls back to `channelId` when `conversationId` is falsy, so DM sessions now correctly write to `pendingIngressTexts` and match the key extracted by `buildAutoCaptureConversationKeyFromSessionKey`
- **Smart extraction threshold**: now uses cumulative turn count (`currentCumulativeCount`) instead of per-event message count
- **MAX_MESSAGE_LENGTH guard**: 5000 char limit per message in `pendingIngressTexts` rolling window prevents OOM from malformed input
- **Test**: added `runCumulativeTurnCountingScenario` in `test/smart-extractor-branches.mjs` verifying turn-1 skip and turn-2 trigger with `extractMinMessages=2`

**⚠️ Breaking change**: `extractMinMessages` semantics changed from "per-event message count" to "cumulative conversation turns". Before: each `agent_end` needed ≥N messages. After: smart extraction triggers at conversation turn N. This is a bug fix since the old semantics were structurally broken for DM; users relying on the old behavior may need to adjust their `extractMinMessages` values.

---

## 1.1.0-beta.2 (Smart Memory Beta + Access Reinforcement)

This is a **beta** release published under the npm dist-tag **`beta`** (it does not affect the stable `latest` channel).

Highlights:
- **Smart Extraction (LLM-powered)**: 6-category extraction with L0/L1/L2 metadata (falls back to regex capture when disabled or init fails)
- **Lifecycle scoring integrated into retrieval**: decay-based score adjustment + tier floors
- **Tier transitions (best-effort)**: bounded metadata write-backs for top results (tier / access stats)
- **Access reinforcement for time decay**: frequently *manually recalled* memories decay more slowly (spaced-repetition style)
  - Adds `AccessTracker` with debounced metadata write-back (accessCount / lastAccessedAt)
  - Adds retrieval config: `reinforcementFactor` (default: 0.5) and `maxHalfLifeMultiplier` (default: 3)

Notes:
- Access reinforcement is gated to manual recall (`source: \"manual\"`) to avoid auto-recall strengthening noise.

---

## 1.1.0-beta.1 (Smart Memory Beta)

- Initial beta with Smart Extraction + lifecycle components (decay engine + tier manager)

---

## 1.0.26

**Access Reinforcement for Time Decay**

- **Feat**: Access reinforcement — frequently *manually recalled* memories decay more slowly (spaced-repetition style)
- **New**: `AccessTracker` with debounced metadata write-back (records accessCount / lastAccessedAt)
- **New**: Config options under `retrieval`: `reinforcementFactor` (default: 0.5) and `maxHalfLifeMultiplier` (default: 3)
- **New**: `MemoryStore.getById()` pure-read helper for efficient metadata lookup

PR: #37

Breaking changes: None. Backward compatible (set `reinforcementFactor: 0` to disable).

---


## 1.0.22

**Storage Path Validation & Better Error Messages**

- **Fix**: Validate `dbPath` at startup — resolve symlinks, auto-create missing directories, check write permissions (#26, #27)
- **Fix**: Write/connection failures now include `errno`, resolved path, and actionable fix suggestions instead of generic errors (#28)
- **New**: Exported `validateStoragePath()` utility for external tooling and diagnostics

Breaking changes: None. Backward compatible.

---

## 1.0.21

**Long Context Chunking**

- **Feats**: Added automatic chunking for documents exceeding embedding context limits
- **Feats**: Smart semantic-aware chunking at sentence boundaries with configurable overlap
- **Feats**: Chunking adapts to different embedding model context limits (Jina, OpenAI, Gemini, etc.)
- **Feats**: Parallel chunk embedding with averaged result for better semantic preservation
- **Fixes**: Handles "Input length exceeds context length" errors gracefully
- **Docs**: Added comprehensive documentation in docs/long-context-chunking.md

Breaking changes: None. Backward compatible with existing configurations.

---

## 1.0.20

- Fix: reduce auto-capture noise by skipping memory-management prompts (delete/forget/cleanup memory entries).
- Improve: broaden English decision triggers so statements like "we decided / going forward we will use" are captured as decisions.

## 1.0.19

- UX: show memory IDs in `memory-cip list` and `memory-cip search` output, so users can delete entries without switching to JSON.
- UX: include IDs in agent tool outputs (`memory_recall`, `memory_list`) for easier debugging and `memory_forget` follow-ups.

## 1.0.18

- Fix: sync `openclaw.plugin.json` version with `package.json`, so the OpenClaw plugin info shows the correct version.

## 1.0.17

- Fix: adaptive-retrieval now strips OpenClaw-injected timestamp prefixes like `[Mon YYYY-MM-DD HH:MM ...] ...` to avoid skewing length-based heuristics.
- Improve: expanded SKIP/FORCE keyword patterns with Traditional Chinese variants.

## 1.0.16

- Feat: expand memory capture triggers to support Traditional Chinese (繁體中文) in addition to Simplified Chinese, and improve category detection keywords.

## 1.0.15

- Docs: add troubleshooting note for LanceDB/Arrow returning `BigInt` numeric columns, and confirm the plugin coerces numeric fields via `Number(...)` for compatibility.

## 1.0.14

- Fix: coerce LanceDB/Arrow numeric columns that may arrive as `BigInt` (`timestamp`, `importance`, `_distance`, `_score`) into `Number(...)` to avoid runtime errors like "Cannot mix BigInt and other types" on LanceDB 0.26+.

## 1.0.13

- Fix: Force `encoding_format: "float"` for OpenAI-compatible embedding requests to avoid base64/float ambiguity and dimension mismatch issues with some providers/gateways.
- Feat: Add Voyage AI (`voyage`) as a supported rerank provider, using `top_k` and `Authorization: Bearer` header.
- Refactor: Harden rerank response parser to accept both `results[]`/`data[]` payload shapes and `relevance_score`/`score` field names across all providers.

## 1.0.12

- Fix: ghost memories stuck in autoRecall after deletion (#15). BM25-only results from stale FTS index are now validated via `store.hasId()` before inclusion in fused results. Removed the BM25-only floor score of 0.5 that allowed deleted entries to survive `hardMinScore` filtering.
- Fix: HEARTBEAT pattern now matches anywhere in the prompt (not just at start), preventing autoRecall from triggering on prefixed HEARTBEAT messages.
- Add: `autoRecallMinLength` config option to set a custom minimum prompt length for autoRecall (default: 15 chars English, 6 CJK). Prompts shorter than this threshold are skipped.
- Add: `ping`, `pong`, `test`, `debug` added to skip patterns in adaptive retrieval.

## 1.0.11

- Change: set `autoRecall` default to `false` to avoid the model echoing injected `<relevant-memories>` blocks.

## 1.0.10

- Fix: avoid blocking OpenClaw gateway startup on external network calls by running startup self-checks in the background with timeouts.

## 1.0.9

- Change: update default `retrieval.rerankModel` to `jina-reranker-v3` (still fully configurable).

## 1.0.8

- Add: JSONL distill extractor supports optional agent allowlist via env var `OPENCLAW_JSONL_DISTILL_ALLOWED_AGENT_IDS` (default off / compatible).

## 1.0.7

- Fix: resolve `agentId` from hook context (`ctx?.agentId`) for `before_agent_start` and `agent_end`, restoring per-agent scope isolation when using multi-agent setups.

## 1.0.6

- Fix: auto-recall injection now correctly skips cron prompts wrapped as `[cron:...] run ...` (reduces token usage for cron jobs).
- Fix: JSONL distill extractor filters more transcript/system noise (BOOT.md, HEARTBEAT, CLAUDE_CODE_DONE, queued blocks) to avoid polluting distillation batches.

## 1.0.5

- Add: optional JSONL session distillation workflow (incremental cursor + batch format) via `scripts/jsonl_distill.py`.
- Docs: document the JSONL distiller setup in README (EN) and README_CN (ZH).

## 1.0.4

- Fix: `embedding.dimensions` is now parsed robustly (number / numeric string / env-var string), so it properly overrides hardcoded model dims (fixes Ollama `nomic-embed-text` dimension mismatch).

## 1.0.3

- Fix: `memory-cip reembed` no longer crashes (missing `clampInt` helper).

## 1.0.2

- Fix: pass through `embedding.dimensions` to the OpenAI-compatible `/embeddings` request payload when explicitly configured.
- Chore: unify plugin version fields (`openclaw.plugin.json` now matches `package.json`).

## 1.0.1

- Fix: CLI command namespace updated to `memory-cip`.

## 1.0.0

- Initial npm release.
