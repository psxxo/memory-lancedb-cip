## 1.2.8

**Memory-runtime provenance contract.** The memory capability runtime now exposes
`classifyWorkspaceMemoryPaths(params)` and `supportsWorkspaceMemoryReadSources`, so the host
upholds `MEMORY.md` / `USER.md` as automatically injectable memory context (see
`CHANGELOG.md` for the full entry).

## 1.2.7

**Category taxonomy alignment.** One 10-category vocabulary, identity storage mapping, and
the `import --unknown` / `--category-map` policy (see `CHANGELOG.md` for the full entry).

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

## 1.2.1

Same content as the aborted 1.2.0 submission (its server-side upload failed; 1.2.1 is the publishable release).

## 1.2.0

Full rename to **Memory LanceDB CIP** (`memory-lancedb-cip`):

- Plugin id and display name: `memory-lancedb-cip` / "Memory (LanceDB CIP)".
- Default data path: `~/.openclaw/memory/lancedb-cip`.
- Docs, log/error prefixes, hook registration ids, CLI docs and tests follow the new naming.
- Attribution to the MIT-licensed original project by win4r (CortexReach) is preserved in READMEs and changelogs.
- No install migration: there is no installed base that uses the previous id/path.

# 1.1.1 — OpenClaw 2026.9.5 port (native)

Fork note: this build ports the MIT-licensed original project by win4r (CortexReach)
to OpenClaw **2026.9.5** and replaces the previous compatibility shims with the host's native APIs.

## Changed
- Imports: bare `openclaw/plugin-sdk` type imports → `openclaw/plugin-sdk/core`.
- Memory capability: dropped the removed legacy `api.registerMemoryRuntime` branch; registration stays on `registerMemoryCapability`.
- Hooks: `api.on(...)` registrations now use the native `registrationId` option (the old `name` option is no longer accepted).
- Tool results: all 80 result literals now build through the host's native `textResult()` from `openclaw/plugin-sdk/tool-results`.
- `package.json`: declares `openclaw.compat` (`pluginApi`/`minGatewayVersion`) and `openclaw.build`.
- Tests: harness reads the native `registrationId`; the SDK stub resolves `openclaw/plugin-sdk/tool-results`.

## Verified
- `tsc` build: 0 errors against the 2026.9.5 host types.
- ClawHub Plugin Inspector (runtime capture): PASS, 0 breakages, 0 warnings.
- Full suite: 187 files, failures identical to the pre-port baseline (environment-only), 0 new failures.

## 1.2.0

Rename release: this distribution is now `memory-lancedb-cip` / **Memory LanceDB CIP**.

- Plugin identity renamed end to end: manifest `id`/`name` (`memory-lancedb-cip` / `Memory (LanceDB CIP)`), the plugin `id` registered with the host, memory-capability `provider`/`custom.plugin` ids, hook `registrationId`s (`memory-lancedb-cip.*`), Redis/file lock key prefixes, the diagnostic build tag, and every log/error prefix.
- **Default data path** is `~/.openclaw/memory/lancedb-cip`. The default OAuth token file lives at `~/.openclaw/.memory-lancedb-cip/oauth.json`.
- Install/publish examples now name this fork's distribution package (`clawhub:@psxxo/lancedb-cip`), not the upstream npm package.
- Attribution to the MIT-licensed original project by win4r (CortexReach) is preserved as a plain credit line in every README; all original-project URLs, issue/PR links, setup scripts and skill repositories have been removed from this fork.
- **No migration is required**: this build has no historical installs, so no data-dir or config-key migration path is shipped. A fresh data directory is created on first start.

## 1.1.2
- Removed the unsupported top-level `hooks` field from `openclaw.plugin.json` (ClawHub `manifest-unknown-fields`). Conversation hook access is granted where the host reads it: `plugins.entries.<id>.hooks.allowConversationAccess` in `openclaw.json`.
- Added `assets/icon.png` (256x256 PNG) for ClawHub catalog artwork and included `assets/**` in the published files.
