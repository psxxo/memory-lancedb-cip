# New Session Distillation (Recommended)

> Upstream: the MIT-licensed original project by win4r (CortexReach) — this package is an independent CIP build.

This example shows a **non-blocking /new distillation pipeline**:

- Trigger: `command:new` (when you type `/new`)
- Hook: enqueue a small JSON task file (fast, no LLM calls)
- Worker: a user-level systemd service watches the inbox and runs **Gemini Map-Reduce** over the session JSONL transcript
- Storage: write high-signal, atomic lessons into LanceDB CIP via `openclaw memory-cip import`
- Notify: send a notification message (optional)

Files included:
- `hook/enqueue-lesson-extract/` — OpenClaw workspace hook
- `worker/lesson-extract-worker.mjs` — Map-Reduce extractor + importer + notifier
- `worker/systemd/lesson-extract-worker.service` — user systemd unit

You must provide:
- `GEMINI_API_KEY` in an env file loaded by systemd

Install steps are documented in the main repo README.
