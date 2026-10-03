## 1.6.3

**Three points in one line — the feature surface now matches across the manifest schema, the feature list, and all 11 READMEs (documentation only).**

- DOCS — every `README*.md` (all 11 languages) gained a localized "feature surface" section that
  mirrors `docs/FEATURES.md`'s ten categories and states that the README, `docs/FEATURES.md`, and the
  plugin manifest `configSchema` describe the same surface and ship in the same release.
- DOCS — `docs/FEATURES.md` declares the three-point alignment; `docs/release-checklist.md` adds a
  mandatory "three points in one line" check so a feature change can never land in only one of them.
- NOTE — no runtime change: `dist/` and `src/` are byte-identical to 1.6.0.

## 1.6.2

**Complete documentation set — the nine remaining README languages.**

- DOCS — README_TW/JA/KO/FR/ES/DE/IT/RU/PT-BR each gained a localized "what's new in 1.6.0" section
  (the plugin-owned LLM lane with a `{source:"store"}` SecretRef, the host-following transport
  default, no built-in model defaults, fsync'd queue writes, and the endpoint-based availability
  gate), a corrected configuration example that no longer names the removed default embedding model
  id, and a link to `docs/FEATURES.md`.
- DOCS — all 11 READMEs now link the authoritative feature list, and no README still shows the
  removed default in its configuration example.
- NOTE — supersedes the 1.6.1 submission, which carried only the English and Chinese READMEs.

## 1.6.1

**Documentation catch-up for 1.6.0 — no runtime change.**

- DOCS — `README.md` and `README_CN.md` gain a "what's new in 1.6.0" section covering the
  plugin-owned LLM lane (a `{source:"store"}` SecretRef resolved from the host's shared secret
  store), the host-following transport default, and the removal of built-in model defaults. The
  configuration example no longer shows the removed default embedding model id.
- DOCS — new `docs/FEATURES.md`: the complete feature surface with defaults, Chinese-first, sourced
  from the manifest `configSchema` because the README has historically under-reported it.
- NOTE — the remaining README languages were not updated in this submission; they follow in 1.6.2.

## 1.6.0

**Plugin-owned LLM lane + no built-in model defaults.** The generation lane can resolve its
credential from the host's shared secret store and is now built lazily; the plugin ships no default
model id of its own, and an unconfigured lane follows the host default instead of silently
substituting one.

- SECRETS — SecretRefs accept `{source: "store"}` (shared secret store): values are primed once
  asynchronously through the host's public resolver and read from a cache, failing closed with a
  readable message when unresolved. The manifest's SecretRef source enum now includes `store`.
- LANE — the LLM client is built lazily, so a store-backed `llm.apiKey` resolves after the prime.
  `llm.transport` now defaults to `host`: an unconfigured plugin follows the host's own default
  model rather than disabling smart extraction.
- CONFIG — the built-in default embedding model id is gone. An unconfigured `embedding.model` logs
  an actionable configuration-required notice and reports as unconfigured; the host-default lane
  also announces explicitly that no `llm.model` is configured.
- QUEUE — pending-extraction queue writes are fsynced, and cap trims are reported through
  `onTrim` instead of dropping the oldest records silently.
- GATE — load-safety learns `pluginResolvesModel`: a direct lane with `baseURL` + `apiKey` is
  resolved by the plugin's own endpoint and is no longer judged against the host model catalog.

## 1.5.4

**Ships the finalised system-status dashboard widget asset and the session-start nudge module.**

- ASSETS — `assets/sys-status-widget.html`: percentage tiles now colour through a six-point hue
  anchor ramp (45 青绿 / 56 绿 / 67 黄绿 / 78 黄 / 89 橙红 / 100 红) on the fixed 0–100% axis with
  `{warn:45, red:100}`; the latency tile keeps its window-adaptive axis at 200→700 ms and the
  network tile 5→15 MB/s, both with the two-endpoint linear ramp.
- NUDGE — `src/sys-status-nudge.ts` plus the bundled widget asset let the plugin remind the agent
  once per session to add the widget to a dashboard.

## 1.5.2

**Provenance propagation is now complete: every distilled row a create path mints carries its
raw-block link, not just the primary extraction lane.**

- SECONDARY CREATE PATHS — `SmartExtractor.persistGatedCandidates` (the reflection/mapped-row
  lane) now derives the same `(sessionKey, role, text)` raw-block ids the primary lane does and
  passes them through both of its `bulkStoreAndValidate` calls: the main mapped-row create and the
  deferred-verdict follow-up create. Previously both stored rows with no link, so those summaries
  could not be drilled back to their raw source.
- CALLER WIRING — the reflection hook rebuilds the ordered turns behind its tagged transcript
  (`parseTaggedTranscriptTurns`) and hands them to `persistGatedCandidates` as
  `conversationTurns`, re-applying the raw writer's own normalization so the derived ids resolve
  to blocks that were actually stored.
- Read side and `src/provenance.ts` are unchanged; a caller that supplies no turns still stores
  rows unstamped, so older/unlinked callers stay readable.

Files: `src/smart-extractor.ts`, `index.ts`, `test/reflection-mapped-provenance.test.mjs` (new).

## 1.5.1

**Raw-tier hardening: the index no longer cancels the payload gain, per-block frames share a
host-trained zstd dictionary, raw files move into the plugin data dir, and the extraction lane now
stamps provenance.** Live-measured on the same 12-block sample (9967 raw bytes) that 1.5.0 wrote.

- INDEX v2 — compact framed index. The ~197-byte-per-block JSONL is replaced by an append-only
  sequence of length-prefixed zstd frames of compact JSON with per-frame string tables. On the
  sample the index fell **2362 → 410 bytes** (~34 bytes/block, **5.8× smaller**); index overhead
  fell from ~24% to ~4%. A torn tail frame is skipped; every frame is self-contained, so appends
  from different plugin generations cannot interleave a read-modify-write.
- COMPRESSION — zstd level 19 and a trained dictionary. Node ignores `zstdCompressSync`'s `level`
  option, so the level is set through `params: { 100: 19 }` (ZSTD_c_compressionLevel). Blocks may
  be written against a trained dictionary stored as `raw-blocks.dict.<hash>` with the pointer
  `raw-blocks.dict.current`; every block records the dictionary it used, and a missing dictionary
  degrades to a plain frame rather than losing the block. `scripts/train-raw-dict.mjs` trains it on
  this host's conversation text.
- PLACEMENT — raw files now live in the plugin data dir (beside `memories.lance`), not one level
  up. The 1.5.0 files are migrated once on load into the new location and left in place.
- PROVENANCE — the extraction lane (`src/smart-extractor.ts`) now stamps `rawBlockIds` onto the
  distilled entries it creates, derived from the same (sessionKey, role, text) hash the raw writer
  uses, so a summary names the raw blocks it came from.

**Measured on the live 12-block sample** (raw 9967 bytes; baseline 1.5.0: payload 7211 + index 2362
= 9573, 1.04×):

| variant | payload | index | net | net ratio |
| --- | --- | --- | --- | --- |
| 1.5.0 (JSONL index, no dict) | 7211 | 2362 | 9573 | 1.04× |
| 1.5.1, no dictionary | 6742 | 400 | 7142 | 1.40× |
| 1.5.1, holdout dictionary (sample excluded) | 4691 | 410 | 5101 | **1.95×** |
| 1.5.1, dictionary trained on all host text incl. the sample | 3464 | 408 | 3872 | 2.57× |

Honest read: the index problem is fixed (5.8× smaller index) and the payload improves from 1.38×
to 2.12× with a holdout dictionary; net is 1.95× on this deliberately small, assistant-heavy
sample — essentially at 2× but not clearly above it. Cross-block redundancy is real (whole-stream
level-19 on the same corpus compresses 2.13×) and only a dictionary can recover it per block, but
the 12-block sample gives a dictionary little prior context. Net exceeds 2× (2.57×) only when the
dictionary has seen the evaluated text. Full live-corpus numbers and smaller-sample numbers are in
RAW-FIRST-DESIGN.md.

Files: `src/raw-store.ts`, `src/smart-extractor.ts`, `scripts/train-raw-dict.mjs` (new),
`test/raw-block-store.test.mjs`, `test/raw-store-index-dict.test.mjs` (new).

## 1.5.0

**Raw-first, two-tier memory: every turn is stored verbatim and nothing deletes it.** Storage no
longer depends on a live turn, a model call, the durable queue, or the scheduled sweep. The
extraction lane is demoted from a precondition of storage to optional enrichment on top of a
complete, immutable raw copy. See RAW-FIRST-DESIGN.md.

- RAW TIER — verbatim by default. A new append-only store (`src/raw-store.ts`) writes every
  captured turn as-is with metadata (timestamp, sessionKey, agentId, role, messageId). Each block
  is compressed on its own with Node's built-in zstd codec (`node:zlib`
  `zstdCompressSync`/`zstdDecompressSync`) and appended to a blob file with a byte-offset index
  (`raw-blocks.zst` + `raw-blocks.index.jsonl`, beside `pending-extraction-queue.jsonl`), so any
  single block restores on its own in O(1) with no whole-archive dependency. There is no delete,
  rewrite or truncate path; the writer runs before any value judgement or model call.
- SUMMARY TIER — provenance is mandatory. Distilled entries (summary, tags, entities, embedding)
  must carry a link to the raw block id(s) they came from; an entry without provenance is invalid
  and must not be stored (`src/provenance.ts`). Distilled never replaces raw.
- RETRIEVAL — summarise first, drill on demand. A pure decision module
  (`src/drill-down.ts`) triggers a raw fetch on deterministic signals only: an explicit request
  for the exact words / a quote / full detail, a time or quote reference, or an empty /
  low-confidence summary hit. A model may be a fallback for the ambiguous band, never the sole gate.
- Log lines: `memory-lancedb-cip: raw-write stored=N skipped=M session=… agent=… blocks=[…]` and
  `memory-lancedb-cip: drill-down drill=… mode=… reason=… hits=N topScore=… rawBlocks=[…]`
  (plus `… drill-down loaded=N trigger=… session=…` when raw detail is fetched).

Files: `src/raw-store.ts`, `src/provenance.ts`, `src/drill-down.ts` (new), `index.ts`,
`test/raw-block-store.test.mjs`, `test/provenance-mandatory.test.mjs`,
`test/drill-down-decision.test.mjs` (new).

## 1.4.1

**Extraction now happens at turn start, so the frequent scheduled turn is gone.** The lane no
longer needs a full isolated agent turn every 2 minutes. 1.4.0 proved the scheduled turn works,
but paid for it on a 2 vCPU / 3.7GB host hundreds of times a day.

- PRIMARY — turn-start drain. `before_agent_reply` now checks whether the session starting a turn
  has queued extraction texts and, if so, drains exactly that session through the same
  `runPendingExtractionForAgent` + durable-queue path the scheduled turn used. The drain is issued
  while the run is live (the authority a finished `agent_end` turn lacks) and is deliberately NOT
  awaited, so reply latency is unchanged; at most one drain runs at a time.
- SAFETY NET — the managed cron remains for sessions that never speak again. Its default schedule
  changes from `*/2 * * * *` to `0 */6 * * *`; the gateway-start reconcile updates the existing
  managed job to the new expression. The durable queue (`pending-extraction-queue.jsonl`) and the
  `memory_extract_pending` tool are unchanged and still part of the design.
- Added a pure decision module (`src/turn-start-drain.ts`) covering smart-extraction availability,
  session resolution, queued texts, in-flight drains, and the hourly extraction budget, with
  `test/turn-start-drain-decision.test.mjs`.
- Log lines: `memory-lancedb-cip: turn-start extraction drain for <sessionKey> (trigger=…, queuedTurns=…)`
  then `… turn-start extraction drain complete for <sessionKey>: N created, M merged, K skipped (failed=F)`.

Files: `src/turn-start-drain.ts` (new), `src/extraction-cron.ts`, `index.ts`,
`test/turn-start-drain-decision.test.mjs` (new).

## 1.4.0

**Stable release: the smart-extraction lane now actually extracts.** This closes the sequence
1.3.3 → 1.3.10, in which every earlier attempt was disproved by measurement and replaced:

- 1.3.3 wrapped host completions in a plugin-built AsyncWorkScope (fixed `Async work scope is closed`).
- 1.3.9 moved extraction into a host-scheduled isolated agent turn, because a plugin completion
  fired after its turn ended is refused with `caller authority is no longer active`; the scheduled
  turn's own agent performs the extraction through the `memory_extract_pending` tool.
- The manifest now declares `memory_extract_pending` in `contracts.tools`; without that the host
  drops the tool at registration (`plugin must declare contracts.tools for: …`) and the turn's
  agent has nothing to call.
- 1.3.10 makes the pending queue durable: texts are appended to `pending-extraction-queue.jsonl`
  in the plugin data directory and re-read on drain, because the host re-captures the prepared
  plugin generation per agent run, so the in-memory `autoCaptureDeferredFlushTurns` Map of the
  depositing generation is not the one the draining tool sees.

Configless, no plugin-owned credentials, follows the host model. Verified after a real restart:
`pending extraction drain start: inMemorySessions=0 durableSessions=1 durableEntries=6 mergedSessions=1`
then `scheduled extraction for …: 4 created, 0 merged, 0 skipped`; no `caller authority is no longer
active`, no `contracts.tools` error. Extraction failures of that class were 51/day before.
## 1.3.10

**The pending-extraction queue is durable, so the scheduled turn actually drains it.** 1.3.9's
agent-driven extraction worked, but the queue lived only in the in-memory `autoCaptureDeferredFlushTurns`
Map. The host re-captures the prepared plugin generation per agent run, so the `before_agent_reply`
intercept inside the scheduled cron turn could log "scheduled extraction turn dispatched for 16..18
queued session(s)" from the generation that deposited the texts while the `memory_extract_pending`
tool, running in a different generation, read an empty Map and returned
`{"sessions":0,"created":0,"merged":0,"skipped":0,"failed":0}` ("Nothing queued for memory extraction").

- Deposits are mirrored to a JSONL file (`pending-extraction-queue.jsonl`) beside the plugin's store
  (`dirname(dbPath)`): session key, role, text, messageId, timestamp. The file is capped by entry count
  (2000) and byte size (2 MB); oldest records are dropped first. Writes are best-effort and never break
  capture.
- `runPendingExtractionForAgent` merges the durable queue with whatever the current generation holds in
  memory before draining, so texts deposited by ANY generation (or a previous process) are picked up.
  After a successful extraction it retires exactly the consumed entries from the file; a failed session
  keeps its texts queued (same restore-on-failure semantics).
- A drain-start log line reports `inMemorySessions`, `durableSessions`, `durableEntries`, and
  `mergedSessions`, so the next run proves which generation owns the deposit.
- Configless, no credentials, plugin-side only, still following the host model.

Files: `src/extraction-queue.ts` (new durable store), `index.ts` (deposit mirroring, drain merge,
drain-start log), `test/extraction-queue-durable.test.mjs` (new).

## 1.3.9

**Extraction is now agent-driven, so it actually persists.** 1.3.7/1.3.8 dispatched the managed cron
turn and 1.3.8's intercept ran inside it, but the completion still failed: the host authorizes a plugin
completion only against the live turn that owns the call, and the intercept's flush ran as a detached
background run, so every call came back `agent tool caller authority is no longer active` and ended as
`no memories extracted` (the log showed 35 dispatched turns and 0 persisted memories for the day).

- Ordinary path is queue-only on the host-transport lane: at `agent_end` the capture texts are deposited
  into the deferred queue instead of being handed to a model the finished turn can no longer authorize,
  so nothing is consumed and nothing is lost. A direct-credential lane keeps its in-process extraction.
- The scheduled extraction turn now does the extraction itself: the cron payload carries an explicit
  instruction (token retained for cheap detection) and the turn's agent calls the new
  `memory_extract_pending` tool. Because a tool invocation runs inside the live turn,
  `api.runtime.llm.complete` is authorized there and the plugin's own extract-and-persist pipeline runs
  with the host model, no plugin credential and no per-install configuration.
- Restore-on-failure is preserved on the new path: a session whose extraction returns no usable result
  keeps its queued texts for the next scheduled turn.
- `before_agent_reply` now only gates the turn: nothing queued short-circuits to `NO_REPLY`, otherwise
  the turn is left to run.

Files: `src/extraction-cron.ts` (instruction + payload message), `index.ts` (queue-only lane, deferred
extraction runner, tool registration, intercept gate), `src/tools.ts` (`memory_extract_pending`).

## 1.3.8

**The scheduled extraction turn now actually reaches the plugin.** 1.3.7 registered the managed cron job
and it fired, but the `before_agent_reply` intercept never ran: that hook limits host dispatch through its
`{ eligibleTriggers }` registration option, and a registration without it is not dispatched for cron
turns (docs: `plugins/hooks/reference` — `eligibleTriggers` is `before_agent_reply` only, one or more of
`cron`, `heartbeat`, `user`, …). The intercept now registers with `eligibleTriggers: ["cron",
"heartbeat", "user"]`, so the scheduled isolated turn flushes the queued capture texts inside a turn the
host owns — where the completion's authority is valid.

- `index.ts`: the `before_agent_reply` registration gained its `eligibleTriggers` option.
- Config gate verified on this host: `plugins.entries.memory-lancedb-cip.hooks.allowConversationAccess`
  is already `true`, which non-bundled plugins need for conversation hooks.

## 1.3.7

**Deferred extraction now runs inside a host-scheduled turn instead of after the user's turn.**
The host authorizes a plugin's completion against the live turn, so a post-turn extraction call is refused
("agent tool caller authority is no longer active", and the isolated-runtime retry from 1.3.6 was refused
the same way). This release borrows the host's own scheduler the way memory-lancedb-dreaming does: at
gateway start the plugin resolves the host cron service and reconciles one managed job whose payload is an
isolated `agentTurn` carrying a trigger token. When that turn runs, the host owns it, so the extraction
completion inside it is authorized — no plugin credential, no configuration, and nothing that a host
update can undo.

- `src/extraction-cron.ts`: trigger token and managed-job constants, `resolveCronServiceFromCandidate()`,
  `resolveCronFromGatewayStartupEvent()`, `buildManagedExtractionCronJob()`,
  `reconcileManagedExtractionCron()` (add/update/remove by name or tag, duplicate cleanup), and
  `resolveExtractionCronExpr()` (default `*/2 * * * *`).
- `index.ts`: gateway_start wiring with startup retries when the cron service is not yet available,
  gateway_stop cleanup, and a `before_agent_reply` handler that recognises the trigger token and flushes
  every session's queued capture texts inside that live turn.
- Tests: `llm-host-work-scope` suite still green.

## 1.3.6

**Post-turn completions retry through the host's isolated agent runtime.**
1.3.5 tried to keep the turn alive for capture and did not work: the host authorizes a plugin completion
against the admitting request, and that authority is already gone by the time a post-turn extraction runs
(observed live: the refusal recurred six seconds after the turn's last model response). This release
instead retries the refused call through the host's own isolated execution mode —
`execution: { mode: "isolated-agent-runtime" }` — which asks the host to start a fresh agent runtime for
that one completion rather than riding a finished turn's authority.

Nothing is configured for this and nothing is owned by the plugin: the retry still runs on the host's
model and auth exactly like the rest of the lane, so the plugin stays configless and keeps following the
system. Only an authority-expired refusal triggers the retry; every other failure keeps the previous
behaviour. Isolated mode accepts a single user message, so the system prompt travels in its own field on
the retry. The 1.3.5 hook-hold was reverted as ineffective.

- `src/llm-client.ts`: `runHostCompletion()` + `isHostAuthorityExpiredError()`; both host lanes route
  through it. `RuntimeLlmCompleteFn` now documents `systemPrompt` and `execution`.
- Reverted from 1.3.5: `AUTO_CAPTURE_HOOK_BUDGET_MS` and `awaitCaptureHookBudget()`.
- Tests: `llm-host-work-scope` + `llm-host-transport` → 26 pass / 0 fail.

## 1.3.5

**Withdrawn: the credential-based fallback lane introduced in 1.3.4.** A plugin's LLM lane must follow the
host by default. Requiring operators to configure a second credential for a plugin is neither advanced nor
simple, and every future install would pay for it.

**Instead, capture completes inside the live turn.** A host completion is authorized only while its run is
live (`AgentRunContext(runId) === context`), so the `agent_end` auto-capture hook — which used to fire its
work and return — now stays inside the hook for a bounded window (12 s) while capture runs. The completion
goes out under the turn's own authority: no plugin credential, no configuration, and the lane keeps
following the host's model and auth exactly like the rest of the plugin. Anything slower than the budget
keeps running in the background and is retried by the next turn's hook.

- `index.ts`: `AUTO_CAPTURE_HOOK_BUDGET_MS` and `awaitCaptureHookBudget()`; the `agent_end` hook returns
  the bounded wait instead of a detached `void` run.
- Reverted from 1.3.4: `llm.fallback`, `isHostAuthorityExpiredError`, `createConfiguredFallbackClient`,
  `createAuthorityFallbackClient`, the manifest `llm.fallback` block and their tests.
- Tests: `llm-host-work-scope` + `per-agent-auto-recall` → 27 pass / 0 fail.

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
