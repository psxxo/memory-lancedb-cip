/**
 * LLM Client for memory extraction and dedup decisions.
 * Uses OpenAI-compatible API (reuses the embedding provider config).
 */

import OpenAI from "openai";

/**
 * Strips a core-style provider prefix (e.g. "openrouter/anthropic/claude-...")
 * down to the bare "<vendor>/<model>" form a direct OpenRouter-compatible API
 * needs. Any other prefix, or a string with no "/", passes through unchanged.
 * Shared by the host->direct transport fallback (see createLlmClient) and by
 * admission-control.ts's per-lane model resolution, so both paths agree on
 * exactly one definition of "what a direct client can accept."
 */
export function normalizeDirectModelRef(modelRef: string): string {
  const trimmed = modelRef.trim();
  const idx = trimmed.indexOf("/");
  if (idx <= 0) return trimmed;
  const provider = trimmed.slice(0, idx).trim().toLowerCase();
  if (provider !== "openrouter") return trimmed;
  const rest = trimmed.slice(idx + 1).trim();
  return rest || trimmed;
}

export interface LlmClientConfig {
  apiKey?: string;
  model: string;
  baseURL?: string;
  timeoutMs?: number;
  log?: (msg: string) => void;
  /** Warn-level logger for user-visible failures (timeouts, retries, network errors). */
  warnLog?: (msg: string) => void;
  /**
   * Completion transport. "host" is the DEFAULT used by the plugin (it follows
   * OpenClaw's own default model, so an unconfigured plugin needs no model or
   * credential of its own). "direct" (opt-in) posts straight to llm.baseURL via
   * the bundled OpenAI-compatible client. "host" routes through OpenClaw's
   * host-managed runtime LLM catalog (runtimeLlmComplete,
   * e.g. api.runtime.llm.complete) so provider routing, auth profiles, and app
   * attribution apply automatically. Falls back to the direct transport
   * with a warning when runtimeLlmComplete is not supplied.
   */
  transport?: "direct" | "host";
  /** Host-owned runtime LLM completion surface, required for transport: "host". */
  runtimeLlmComplete?: RuntimeLlmCompleteFn;
  /**
   * Whether `model` traces back to an operator-configured value (llm.model,
   * admissionControl.model, or a lane-affinity memoryReflection.model) rather
   * than a plugin-internal default. Host transport only sends the `model`
   * field when this is true: the host runtime treats any supplied model as a
   * model override and rejects it under the default plugin model-override
   * policy, so an unconfigured model must be omitted to let the host's own
   * default apply. Direct transport ignores this flag (its request always
   * needs a model).
   */
  modelExplicit?: boolean;
  /**
   * Reasoning effort requested from the model, e.g. "low" | "medium" |
   * "high". Canonical config key (llm.thinkLevel), named for consistency
   * with memoryReflection.thinkLevel. Host transport: always sent,
   * defaulting to DEFAULT_HOST_REASONING_EFFORT ("medium") when unset -- an
   * omitted reasoning field has been observed to fall through to a
   * disabled/no-reasoning default further down the host-managed runtime
   * stack, which silently degrades reasoning models (confirmed via a live
   * trace showing rawRequest reasoning: {effort:"none"} for a
   * reasoning-capable model whose request never set the field). Direct
   * transport: sent only when explicitly configured (as reasoning: {effort:
   * ...}, the OpenRouter-compatible shape); when unset, no reasoning
   * parameter is sent at all, letting the provider's own default apply.
   * Resolved from raw config by resolveThinkLevel before either transport
   * reads it.
   */
  thinkLevel?: string;
}

const DEFAULT_SYSTEM_PROMPT =
  "You are a memory extraction assistant. Always respond with valid JSON only.";

export type RuntimeLlmCompleteMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type RuntimeLlmCompleteResult = {
  text: string;
  [key: string]: unknown;
};

export type RuntimeLlmCompleteFn = (params: {
  messages: RuntimeLlmCompleteMessage[];
  model?: string;
  temperature?: number;
  purpose?: string;
  reasoning?: string;
  /** Optional system prompt, separate from the message list. */
  systemPrompt?: string;
  /**
   * Optional host execution selector. `isolated-agent-runtime` asks the host to
   * start a fresh agent runtime for this one completion instead of riding the
   * calling turn's authority.
   */
  execution?: {
    mode: "isolated-agent-runtime";
    authProfileId?: string;
    timeoutMs?: number;
  };
}) => Promise<RuntimeLlmCompleteResult>;

/**
 * Default reasoning effort sent on the host transport when llm.thinkLevel
 * is not configured. "medium" is a universally-supported effort level across
 * the model families OpenClaw's core reasoning-effort normalization knows
 * about, and it never disables reasoning outright the way an omitted field
 * has been observed to (core's own "adaptive" shorthand maps to this same
 * value). Chosen over leaving the field unset, which is what caused the
 * incident this constant documents.
 */
const DEFAULT_HOST_REASONING_EFFORT = "medium";

export interface LlmClient {
  /**
   * Send a prompt and parse the JSON response. Returns null on failure.
   * `systemPrompt`, when provided, replaces the default generic system
   * message with a stage-specific identity/instructions block. `temperature`,
   * when provided, overrides the client's default sampling temperature for
   * this call only (e.g. 0 for callers that need reproducible output).
   */
  completeJson<T>(prompt: string, label?: string, systemPrompt?: string, temperature?: number): Promise<T | null>;
  /**
   * Send a prompt and return the model's answer as trimmed text. No JSON
   * expectation is attached and `systemPrompt` is sent verbatim (no system
   * message at all when omitted). Returns null on a transport failure or an
   * empty answer; `getLastError` carries the reason.
   */
  completeText(prompt: string, label?: string, systemPrompt?: string, temperature?: number): Promise<string | null>;
  /** Best-effort diagnostics for the most recent failure, if any. */
  getLastError(): string | null;
}

/**
 * Extract JSON from an LLM response that may be wrapped in markdown fences
 * or contain surrounding text.
 */
function extractJsonFromResponse(text: string): string | null {
  text = stripReasoningTrace(text);

  const fenceMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)```/);
  if (fenceMatch) {
    return fenceMatch[1].trim();
  }

  const firstBrace = text.indexOf("{");
  if (firstBrace === -1) return null;

  let depth = 0;
  let lastBrace = -1;
  for (let i = firstBrace; i < text.length; i++) {
    if (text[i] === "{") depth++;
    else if (text[i] === "}") {
      depth--;
      if (depth === 0) {
        lastBrace = i;
        break;
      }
    }
  }

  if (lastBrace === -1) return null;
  return text.substring(firstBrace, lastBrace + 1);
}

function stripReasoningTrace(text: string): string {
  const closingThinkTag = text.toLowerCase().lastIndexOf("</think>");
  if (closingThinkTag === -1) return text;
  return text.slice(closingThinkTag + "</think>".length).trim();
}

/**
 * Best-effort recovery when a model streams its answer only into a reasoning
 * field and leaves the regular content empty (e.g. a gateway that doesn't
 * honor enable_thinking:false). Checks both naming conventions seen across
 * providers: OpenAI/DeepSeek's `reasoning_content` and vLLM's `reasoning`.
 */
function pickReasoningText(source: unknown): string | undefined {
  if (!source || typeof source !== "object") return undefined;
  const record = source as Record<string, unknown>;
  const reasoningContent = record.reasoning_content;
  if (typeof reasoningContent === "string" && reasoningContent.trim()) return reasoningContent;
  const reasoning = record.reasoning;
  if (typeof reasoning === "string" && reasoning.trim()) return reasoning;
  return undefined;
}

function recoverJsonFromReasoning<T>(reasoningText: string | undefined): T | null {
  if (!reasoningText) return null;
  const jsonStr = extractJsonFromResponse(reasoningText);
  if (!jsonStr) return null;
  try {
    return JSON.parse(jsonStr) as T;
  } catch {
    return null;
  }
}

function shouldDisableReasoningForJson(model: string): boolean {
  return /qwen3|deepseek.*r1|qwq/i.test(model);
}

/** Restrict a call label to header-safe characters (labels are internal literals). */
function sanitizeLabelHeader(label: string): string {
  const cleaned = label.replace(/[^A-Za-z0-9._-]/g, "-").slice(0, 64);
  return cleaned || "generic";
}

function previewText(value: string, maxLen = 200): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLen) return normalized;
  return `${normalized.slice(0, maxLen - 3)}...`;
}

function nextNonWhitespaceChar(text: string, start: number): string | undefined {
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (!/\s/.test(ch)) return ch;
  }
  return undefined;
}

/**
 * Best-effort repair for common LLM JSON issues:
 * - unescaped quotes inside string values
 * - raw newlines / tabs inside strings
 * - trailing commas before } or ]
 */
function repairCommonJson(text: string): string {
  let result = "";
  let inString = false;
  let escaped = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];

    if (escaped) {
      result += ch;
      escaped = false;
      continue;
    }

    if (inString) {
      if (ch === "\\") {
        result += ch;
        escaped = true;
        continue;
      }

      if (ch === "\"") {
        const nextCh = nextNonWhitespaceChar(text, i + 1);
        if (
          nextCh === undefined ||
          nextCh === "," ||
          nextCh === "}" ||
          nextCh === "]" ||
          nextCh === ":"
        ) {
          result += ch;
          inString = false;
        } else {
          result += "\\\"";
        }
        continue;
      }

      if (ch === "\n") {
        result += "\\n";
        continue;
      }
      if (ch === "\r") {
        result += "\\r";
        continue;
      }
      if (ch === "\t") {
        result += "\\t";
        continue;
      }

      result += ch;
      continue;
    }

    if (ch === "\"") {
      result += ch;
      inString = true;
      continue;
    }

    if (ch === ",") {
      const nextCh = nextNonWhitespaceChar(text, i + 1);
      if (nextCh === "}" || nextCh === "]") {
        continue;
      }
    }

    result += ch;
  }

  return result;
}

/**
 * Bounds a host-transport call with an application-level timer. The runtime
 * LLM surface has no AbortSignal parameter, so this cannot cancel the
 * underlying request -- it only stops waiting on it, mirroring the direct
 * transport's timeoutMs contract from the caller's point of view.
 */
function raceWithTimeout<T>(promise: Promise<T>, timeoutMs: number | undefined): Promise<T> {
  const effectiveTimeoutMs =
    typeof timeoutMs === "number" && Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 30_000;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`timed out after ${effectiveTimeoutMs}ms`)),
      effectiveTimeoutMs,
    );
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

/**
 * Runs a host-managed completion inside a FRESH async work scope.
 *
 * The host tracks \`api.runtime.llm.complete\` against whatever async work scope
 * is active at call time (\`captureAsyncWorkTracker()\` -> \`scope.track(run)\`),
 * and \`AsyncWorkScope.track\` rejects with \`Async work scope is closed\` once that
 * scope has closed. Our extraction/dedup lanes run deferred (timers scheduled
 * from inside a hook), so they still inherit the finished turn's scope through
 * AsyncLocalStorage long after the turn ended -- which made every deferred
 * host-transport call fail. Entering our own open scope first makes the host
 * track the call against a live scope instead. Best effort: if the host does
 * not export the helper, or entering the scope throws, the call runs as before.
 */
interface HostWorkScope {
  track<T>(run: () => Promise<T>): Promise<T>;
}
type HostWorkScopeCtor = new () => HostWorkScope;

let hostWorkScopeCtor: HostWorkScopeCtor | null | undefined;

/** Test hook: forget the cached host scope constructor. */
export function resetHostWorkScopeCacheForTests(): void {
  hostWorkScopeCtor = undefined;
}

/** Test hook: inject a fake host scope constructor (or null for "unavailable"). */
export function setHostWorkScopeCtorForTests(ctor: HostWorkScopeCtor | null): void {
  hostWorkScopeCtor = ctor;
}

async function resolveHostWorkScopeCtor(): Promise<HostWorkScopeCtor | null> {
  if (hostWorkScopeCtor !== undefined) return hostWorkScopeCtor;
  try {
    // Variable specifier: keeps the subpath out of static resolution so this
    // module still loads on hosts that do not ship it.
    const specifier = "openclaw/plugin-sdk/concurrency-runtime";
    const mod = (await import(specifier)) as { AsyncWorkScope?: HostWorkScopeCtor };
    hostWorkScopeCtor = typeof mod?.AsyncWorkScope === "function" ? mod.AsyncWorkScope : null;
  } catch {
    hostWorkScopeCtor = null;
  }
  return hostWorkScopeCtor;
}

async function runInHostWorkScope<T>(run: () => Promise<T>): Promise<T> {
  const Ctor = await resolveHostWorkScopeCtor();
  if (!Ctor) return run();
  let scope: HostWorkScope;
  try {
    scope = new Ctor();
  } catch {
    return run();
  }
  return scope.track(run);
}

/** Host refusal signatures that mean "this call outlived its turn's authority". */
const HOST_AUTHORITY_EXPIRED_SIGNATURES = [
  "async work scope is closed",
  "caller authority is no longer active",
  "caller authority is no longer current",
  "caller authority is unavailable",
];

/** True when a host-transport failure says the call's authority had ended. */
export function isHostAuthorityExpiredError(error: unknown): boolean {
  const message = (error instanceof Error ? error.message : String(error ?? "")).toLowerCase();
  return HOST_AUTHORITY_EXPIRED_SIGNATURES.some((signature) => message.includes(signature));
}

type HostCompletionParams = Parameters<RuntimeLlmCompleteFn>[0];

/**
 * Runs one host-managed completion.
 *
 * The host authorizes a plugin completion against the live turn, so a call made
 * after that turn ended is refused ("caller authority is no longer active").
 * Hosts that expose the isolated execution mode can be asked for a fresh agent
 * runtime instead — that mode does not ride the finished turn's authority. The
 * retry keeps this lane configless (no plugin credential) and still uses the
 * host's own model and auth. Isolated mode accepts exactly one user message, so
 * the system prompt travels in its own field on the retry.
 */
async function runHostCompletion(
  runtimeLlmComplete: RuntimeLlmCompleteFn,
  params: HostCompletionParams,
  config: LlmClientConfig,
  log: (msg: string) => void,
): Promise<RuntimeLlmCompleteResult> {
  try {
    return await runInHostWorkScope(() => runtimeLlmComplete(params));
  } catch (err) {
    if (!isHostAuthorityExpiredError(err)) throw err;
    const systemMessages = params.messages.filter((message) => message.role === "system");
    const userMessages = params.messages.filter((message) => message.role !== "system");
    log(
      `memory-lancedb-cip: llm-client [${params.purpose ?? "generic"}] host transport refused the call after its turn ended; retrying through the host's isolated agent runtime`,
    );
    return await runInHostWorkScope(() =>
      runtimeLlmComplete({
        ...params,
        messages: userMessages.length ? [userMessages[userMessages.length - 1]] : params.messages,
        ...(systemMessages.length
          ? { systemPrompt: systemMessages.map((message) => message.content).join("\n") }
          : {}),
        execution: { mode: "isolated-agent-runtime", timeoutMs: config.timeoutMs },
      }),
    );
  }
}

function createHostClient(
  config: LlmClientConfig,
  runtimeLlmComplete: RuntimeLlmCompleteFn,
  log: (msg: string) => void,
  warnLog?: (msg: string) => void,
): LlmClient {
  let lastError: string | null = null;

  return {
    async completeJson<T>(prompt: string, label = "generic", systemPrompt?: string, temperature?: number): Promise<T | null> {
      lastError = null;
      try {
        const result = await raceWithTimeout(
          runHostCompletion(runtimeLlmComplete, {
            messages: [
              {
                role: "system",
                content:
                  systemPrompt ??
                  "You are a memory extraction assistant. Always respond with valid JSON only.",
              },
              { role: "user", content: prompt },
            ],
            // Only an operator-selected model rides the request: the host
            // runtime treats any supplied model as a model override and
            // rejects it unless the plugin's override policy allows it, so a
            // plugin-internal default model must be omitted here to let the
            // host's own lane default apply.
            ...(config.modelExplicit ? { model: config.model } : {}),
            temperature: temperature ?? 0.1,
            purpose: `memory-lancedb-cip:${label}`,
            reasoning: config.thinkLevel?.trim() || DEFAULT_HOST_REASONING_EFFORT,
          }, config, warnLog ?? log),
          config.timeoutMs,
        );

        const raw = result?.text;
        if (!raw || typeof raw !== "string") {
          lastError =
            `memory-lancedb-cip: llm-client [${label}] empty host-transport response content from model ${config.model}`;
          log(lastError);
          return null;
        }

        const jsonStr = extractJsonFromResponse(raw);
        if (!jsonStr) {
          lastError =
            `memory-lancedb-cip: llm-client [${label}] no JSON object found in host-transport response (chars=${raw.length}, preview=${JSON.stringify(previewText(raw))})`;
          log(lastError);
          return null;
        }

        try {
          return JSON.parse(jsonStr) as T;
        } catch (err) {
          const repairedJsonStr = repairCommonJson(jsonStr);
          if (repairedJsonStr !== jsonStr) {
            try {
              const repaired = JSON.parse(repairedJsonStr) as T;
              log(
                `memory-lancedb-cip: llm-client [${label}] recovered malformed host-transport JSON via heuristic repair (jsonChars=${jsonStr.length})`,
              );
              return repaired;
            } catch (repairErr) {
              lastError =
                `memory-lancedb-cip: llm-client [${label}] host-transport JSON.parse failed: ${err instanceof Error ? err.message : String(err)}; repair failed: ${repairErr instanceof Error ? repairErr.message : String(repairErr)} (jsonChars=${jsonStr.length}, jsonPreview=${JSON.stringify(previewText(jsonStr))})`;
              log(lastError);
              return null;
            }
          }
          lastError =
            `memory-lancedb-cip: llm-client [${label}] host-transport JSON.parse failed: ${err instanceof Error ? err.message : String(err)} (jsonChars=${jsonStr.length}, jsonPreview=${JSON.stringify(previewText(jsonStr))})`;
          log(lastError);
          return null;
        }
      } catch (err) {
        lastError =
          `memory-lancedb-cip: llm-client [${label}] host-transport request failed for model ${config.model}: ${err instanceof Error ? err.message : String(err)}`;
        (warnLog ?? log)(lastError);
        return null;
      }
    },
    async completeText(prompt: string, label = "generic", systemPrompt?: string, temperature?: number): Promise<string | null> {
      lastError = null;
      const messages: RuntimeLlmCompleteMessage[] = [];
      if (systemPrompt !== undefined) messages.push({ role: "system", content: systemPrompt });
      messages.push({ role: "user", content: prompt });
      try {
        const result = await raceWithTimeout(
          runHostCompletion(runtimeLlmComplete, {
            messages,
            ...(config.modelExplicit ? { model: config.model } : {}),
            temperature: temperature ?? 0.1,
            purpose: `memory-lancedb-cip:${label}`,
            reasoning: config.thinkLevel?.trim() || DEFAULT_HOST_REASONING_EFFORT,
          }, config, warnLog ?? log),
          config.timeoutMs,
        );
        const text = typeof result?.text === "string" ? result.text.trim() : "";
        if (!text) {
          lastError =
            `memory-lancedb-cip: llm-client [${label}] empty host-transport response content from model ${config.model}`;
          log(lastError);
          return null;
        }
        return text;
      } catch (err) {
        lastError =
          `memory-lancedb-cip: llm-client [${label}] host-transport request failed for model ${config.model}: ${err instanceof Error ? err.message : String(err)}`;
        (warnLog ?? log)(lastError);
        return null;
      }
    },
    getLastError(): string | null {
      return lastError;
    },
  };
}

function createApiKeyClient(config: LlmClientConfig, log: (msg: string) => void, warnLog?: (msg: string) => void): LlmClient {
  if (!config.apiKey) {
    throw new Error("LLM api-key mode requires llm.apiKey or embedding.apiKey");
  }

  const client = new OpenAI({
    apiKey: config.apiKey,
    baseURL: config.baseURL,
    timeout: config.timeoutMs ?? 60000,
  });
  let lastError: string | null = null;

  return {
    async completeJson<T>(prompt: string, label = "generic", systemPrompt?: string, temperature?: number): Promise<T | null> {
      lastError = null;
      try {
        const request = {
          model: config.model,
          messages: [
            {
              role: "system",
              content: systemPrompt ?? DEFAULT_SYSTEM_PROMPT,
            },
            { role: "user", content: prompt },
          ],
          temperature: temperature ?? 0.1,
          ...(config.thinkLevel?.trim()
            ? { reasoning: { effort: config.thinkLevel.trim() } }
            : {}),
          ...(shouldDisableReasoningForJson(config.model)
            ? { chat_template_kwargs: { enable_thinking: false } }
            : {}),
        };

        // Transmit the internal call label as a request header so gateway-side
        // observability (tracing UIs, proxy logs) can distinguish call sites
        // without any change to the prompt or sampling parameters.
        const response = await client.chat.completions.create(request as any, {
          headers: { "x-memory-call-label": sanitizeLabelHeader(label) },
        });

        const message = response.choices?.[0]?.message;
        const raw = message?.content;
        if (!raw) {
          const recovered = recoverJsonFromReasoning<T>(pickReasoningText(message));
          if (recovered !== null) {
            log(
              `memory-lancedb-cip: llm-client [${label}] recovered JSON from reasoning field (model ${config.model})`,
            );
            return recovered;
          }
          lastError =
            `memory-lancedb-cip: llm-client [${label}] empty response content from model ${config.model}`;
          log(lastError);
          return null;
        }
        if (typeof raw !== "string") {
          lastError =
            `memory-lancedb-cip: llm-client [${label}] non-string response content type=${Array.isArray(raw) ? "array" : typeof raw} from model ${config.model}`;
          log(lastError);
          return null;
        }

        const jsonStr = extractJsonFromResponse(raw);
        if (!jsonStr) {
          lastError =
            `memory-lancedb-cip: llm-client [${label}] no JSON object found (chars=${raw.length}, preview=${JSON.stringify(previewText(raw))})`;
          log(lastError);
          return null;
        }

        try {
          return JSON.parse(jsonStr) as T;
        } catch (err) {
          const repairedJsonStr = repairCommonJson(jsonStr);
          if (repairedJsonStr !== jsonStr) {
            try {
              const repaired = JSON.parse(repairedJsonStr) as T;
              log(
                `memory-lancedb-cip: llm-client [${label}] recovered malformed JSON via heuristic repair (jsonChars=${jsonStr.length})`,
              );
              return repaired;
            } catch (repairErr) {
              lastError =
                `memory-lancedb-cip: llm-client [${label}] JSON.parse failed: ${err instanceof Error ? err.message : String(err)}; repair failed: ${repairErr instanceof Error ? repairErr.message : String(repairErr)} (jsonChars=${jsonStr.length}, jsonPreview=${JSON.stringify(previewText(jsonStr))})`;
              log(lastError);
              return null;
            }
          }
          lastError =
            `memory-lancedb-cip: llm-client [${label}] JSON.parse failed: ${err instanceof Error ? err.message : String(err)} (jsonChars=${jsonStr.length}, jsonPreview=${JSON.stringify(previewText(jsonStr))})`;
          log(lastError);
          return null;
        }
      } catch (err) {
        lastError =
          `memory-lancedb-cip: llm-client [${label}] request failed for model ${config.model}: ${err instanceof Error ? err.message : String(err)}`;
        (warnLog ?? log)(lastError);
        return null;
      }
    },
    async completeText(prompt: string, label = "generic", systemPrompt?: string, temperature?: number): Promise<string | null> {
      lastError = null;
      try {
        const request = {
          model: config.model,
          messages: [
            ...(systemPrompt !== undefined ? [{ role: "system", content: systemPrompt }] : []),
            { role: "user", content: prompt },
          ],
          temperature: temperature ?? 0.1,
          ...(config.thinkLevel?.trim()
            ? { reasoning: { effort: config.thinkLevel.trim() } }
            : {}),
        };
        const response = await client.chat.completions.create(request as any, {
          headers: { "x-memory-call-label": sanitizeLabelHeader(label) },
        });
        const raw = response.choices?.[0]?.message?.content;
        const text = typeof raw === "string" ? raw.trim() : "";
        if (!text) {
          lastError =
            `memory-lancedb-cip: llm-client [${label}] empty response content from model ${config.model}`;
          log(lastError);
          return null;
        }
        return text;
      } catch (err) {
        lastError =
          `memory-lancedb-cip: llm-client [${label}] request failed for model ${config.model}: ${err instanceof Error ? err.message : String(err)}`;
        (warnLog ?? log)(lastError);
        return null;
      }
    },
    getLastError(): string | null {
      return lastError;
    },
  };
}

/** OpenRouter's direct API base URL, used as the host->direct fallback's default when llm.baseURL is not configured. */
// Module-level (not per-client) so the "runtime surface unavailable"
// warning is emitted once per process even though createLlmClient is
// called once per lane (extraction, admission, CLI) and each call would
// otherwise re-detect and re-warn about the same missing host surface.
let hostTransportFallbackWarned = false;

/** Test-only: resets the process-level fallback-warn dedupe flag. */
export function resetHostTransportFallbackWarnForTests(): void {
  hostTransportFallbackWarned = false;
}

/**
 * Resolves the canonical llm.thinkLevel value. Blank/whitespace-only values
 * are treated as unset.
 *
 * Presence-based by construction: "configured" here means "a non-blank
 * string reached this function." That is only a correct proxy for "the
 * user actually set it" as long as the openclaw.plugin.json llm.thinkLevel
 * schema entry does not declare a JSON-schema "default" -- a schema default
 * gets materialized into the config object upstream (observed on at least
 * one OpenClaw host config-loading path) before this function ever runs,
 * indistinguishably from a genuine user value. Do not add "default" back to
 * the manifest key (2026-07-16 live incident).
 */
export function resolveThinkLevel(
  config: Pick<LlmClientConfig, "thinkLevel">,
): string | undefined {
  return config.thinkLevel?.trim() || undefined;
}

export function createLlmClient(config: LlmClientConfig): LlmClient {
  const log = config.log ?? (() => {});
  const warnLog = config.warnLog;
  config = { ...config, thinkLevel: resolveThinkLevel(config) };
  if (config.transport === "host") {
    if (typeof config.runtimeLlmComplete === "function") {
      return createHostClient(config, config.runtimeLlmComplete, log, warnLog);
    }
    if (!hostTransportFallbackWarned) {
      hostTransportFallbackWarned = true;
      (warnLog ?? log)(
        "memory-lancedb-cip: llm-client transport \"host\" is configured but the OpenClaw runtime.llm.complete surface is unavailable on this host; falling back to the direct transport",
      );
    }
    // The configured model may be a core-style catalog reference (e.g.
    // "openrouter/anthropic/claude-...") that only the host-managed runtime
    // resolves; the fallback transports need the bare provider-stripped id.
    // Only this fallback path normalizes -- an explicitly configured direct
    // transport keeps sending whatever model string it was given, unchanged.
    config = { ...config, model: normalizeDirectModelRef(config.model) };
    if (!config.apiKey) {
      throw new Error(
        "memory-lancedb-cip: llm-client transport \"host\" fell back to the direct transport, but no llm.apiKey is configured. " +
          "The direct fallback does not inherit embedding.apiKey when transport is \"host\" -- set llm.apiKey explicitly.",
      );
    }
    const explicitFallbackBaseURL = config.baseURL?.trim();
    if (!explicitFallbackBaseURL) {
      throw new Error(
        "memory-lancedb-cip: llm-client transport \"host\" fell back to the direct transport, but no llm.baseURL is configured. " +
          "Refusing to send llm.apiKey to an inferred third-party endpoint -- set llm.baseURL explicitly for the fallback.",
      );
    }
    config = { ...config, baseURL: explicitFallbackBaseURL };
    return createApiKeyClient(config, log, warnLog);
  }
  return createApiKeyClient(config, log, warnLog);
}

export { extractJsonFromResponse, repairCommonJson, shouldDisableReasoningForJson, stripReasoningTrace };
