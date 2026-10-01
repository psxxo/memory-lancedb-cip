# ClawHub static-analysis notes

ClawHub reports this package as `suspicious`. The label comes from pattern-based
static analysis over the published artifact (scope `artifact-only`, tier
`source-linked`), not from a confirmed vulnerability. The five rule families it
hits are capabilities this plugin must have. Each is mapped to its code below,
recorded 2026-10-01 for v1.4.0 (source commit 2d95dc78).

## 1. Environment-variable access

Rule family: environment variable access.

- `src/session-recovery.ts` — `process.env.OPENCLAW_HOME`
- `index.ts` — `process.env.OPENCLAW_CLI`, `process.env.OPENCLAW_HOME`
- `cli.ts` — `process.env.OPENCLAW_CONFIG_PATH`, `process.env.OPENCLAW_HOME`

Why: standard host discovery (home dir, config path) and CLI detection. No
environment value is transmitted anywhere.

## 2. Filesystem access

Rule family: filesystem access.

- `src/openclaw-memory-capability.ts` — `readFile` of the host's memory
  capability files
- `src/admission-stats.ts` — `readFile` of its own stats
- the plugin's own store directory (LanceDB files plus the durable
  `pending-extraction-queue.jsonl`)

Why: a memory plugin reads and writes its own store, and reads the host's
declared memory capability. Paths are confined to the plugin data dir and the
OpenClaw home/config locations.

## 3. Network access

Rule family: network access.

- `src/embedder.ts` — `fetch` to the embeddings endpoint
- `src/llm-client.ts` — `fetch` to the completion endpoint
- `src/retriever.ts`, `src/llm-oauth.ts` — retrieval and OAuth token requests

Why: embeddings and extraction completions are remote calls. The plugin ships
no credential of its own; it follows the host's provider configuration.

## 4. Imported / referenced package patterns

Rule family: imported or referenced packages.

Why: ordinary module imports of the runtime and the OpenClaw plugin SDK. No
dynamic `require` of remote code, no postinstall fetch, no obfuscation — the
published artifact is plain compiled TypeScript.

## 5. Prompt-injection instruction patterns

Rule family: prompt-injection instruction patterns.

- `src/extraction-prompts.ts` — the extraction prompts ("You MUST choose
  SKIP", "You are a grounding reviewer for a memory system … Your verdict is
  final"). Natural-language instructions sent to the model by design.
- `src/reflection-slices.ts` — a regular expression that **detects** attempts to
  elicit system prompts or secrets. This is defensive code; it also matches
  instruction-pattern heuristics.

Why: extraction quality depends on precise prompts. The only injection-shaped
construct in the codebase is a guard against injection, not a payload.

## Status

Readiness check (2026-10-01): `blocked` — FAIL `official` (not in the official
channel) and FAIL `scan` (suspicious). Everything else passes: latest 1.4.0,
ClawPack artifact, SHA-256 digest, source 2d95dc78, compatibility >=2026.9.5.
