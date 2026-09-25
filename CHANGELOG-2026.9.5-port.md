# 1.1.1 — OpenClaw 2026.9.5 port (native)

Fork note: this build ports `memory-lancedb-pro` (upstream: github.com/CortexReach/memory-lancedb-pro, MIT, author win4r)
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

## 1.1.2
- Removed the unsupported top-level `hooks` field from `openclaw.plugin.json` (ClawHub `manifest-unknown-fields`). Conversation hook access is granted where the host reads it: `plugins.entries.<id>.hooks.allowConversationAccess` in `openclaw.json`.
- Added `assets/icon.png` (256x256 PNG) for ClawHub catalog artwork and included `assets/**` in the published files.

## 1.1.3
- Same content as the aborted 1.1.2 submission (its server-side upload failed with an OOM, leaving a version stub): manifest without the unsupported top-level `hooks`, `assets/icon.png` catalog artwork.
