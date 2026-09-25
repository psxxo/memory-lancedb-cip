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
