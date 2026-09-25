/**
 * Load-time safety (v1.2.6)
 *
 * The plugin installed into a host must NEVER be able to wedge the host's event
 * loop at load time. Two real incident root causes are guarded here:
 *
 *   1. A generation-LLM call defaulting to a model the host does not have
 *      (`openai/gpt-oss-120b`) with a 30s timeout, repeatedly blocking the
 *      main process. -> smart extraction is now opt-in (default OFF) and, when
 *      the effective generation model cannot be confirmed available in the
 *      HOST model inventory, the feature is disabled BEFORE any client is
 *      built. It is never called.
 *   2. A load-time prewarm embedding network request. -> the load path issues
 *      ZERO outbound requests: this module and the code it backs are pure,
 *      synchronous, and side-effect free. Any warmup is deferred to first use.
 *
 * Everything here is deliberately synchronous and defensive: it reads already
 * materialised host config / runtime surfaces and never performs I/O.
 */

/** Historical default model reference used by the memory generation LLM. */
export const DEFAULT_GENERATION_MODEL = "openai/gpt-oss-120b";

export interface GenerationModelResolution {
  /** Effective generation-LLM reference (provider/model, or a bare id). */
  modelRef: string;
  /** Bare model id with a provider prefix removed, when one was present. */
  modelId: string;
  /** Provider segment parsed off the reference, when one was present. */
  provider?: string;
  /** True when the operator set llm.model explicitly (vs. the built-in default). */
  explicit: boolean;
}

export interface HostModelInventory {
  /**
   * Every model reference the host has confirmed it can serve. Stored in
   * canonical lower-case form; both the full `provider/model` form and the
   * bare `model` form are inserted for each entry.
   */
  refs: Set<string>;
  /** Lower-cased provider ids the host has configured. */
  providers: Set<string>;
  /** Human-readable list of the host surfaces that contributed entries. */
  sources: string[];
  /**
   * True when the host inventory could be read and contained at least one
   * entry. False means availability CANNOT be confirmed (no surface, empty
   * catalog, or unreadable runtime) — callers must fail closed.
   */
  confirmed: boolean;
}

export type ModelAvailabilityStatus = "available" | "unavailable" | "unconfirmed";

export interface GenerationModelAvailability {
  status: ModelAvailabilityStatus;
  /** Readable explanation of the status (used verbatim in logs/doctor). */
  reason: string;
  /** The inventory reference that matched, when status is "available". */
  matchedRef?: string;
  /** Which host surface produced the inventory (or "none"). */
  inventorySource: string;
  /** Number of catalog refs the host exposed. */
  inventorySize: number;
}

const MODEL_ID_KEYS = ["id", "model", "name", "slug"] as const;

function asTrimmedString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : undefined;
}

/**
 * Parse a model reference into provider + bare id. Only the FIRST "/" is a
 * candidate separator, and only when the prefix looks like a provider id
 * (lower-case, no dot, no whitespace) — a bare HuggingFace-style id such as
 * `meta-llama/Llama-3.1-8B` keeps its slash when the prefix is not a known
 * provider. `knownProviders` (when supplied) is the authority for the split.
 */
export function parseGenerationModelRef(
  modelRef: string,
  knownProviders?: Set<string>,
): { modelId: string; provider?: string } {
  const trimmed = modelRef.trim();
  const idx = trimmed.indexOf("/");
  if (idx <= 0) return { modelId: trimmed };
  const prefix = trimmed.slice(0, idx);
  const rest = trimmed.slice(idx + 1).trim();
  if (!rest) return { modelId: trimmed };

  const prefixLooksLikeProvider = /^[a-z0-9][a-z0-9._-]*$/.test(prefix);
  if (knownProviders && knownProviders.size > 0) {
    // The host told us which providers exist: a prefix that is NOT one of them
    // is part of the model id (e.g. "meta-llama/Llama-3.1-8B").
    if (knownProviders.has(prefix.toLowerCase())) {
      return { modelId: rest, provider: prefix.toLowerCase() };
    }
    return { modelId: trimmed };
  }
  return prefixLooksLikeProvider
    ? { modelId: rest, provider: prefix.toLowerCase() }
    : { modelId: trimmed };
}

/** Resolve the generation LLM the smart extractor would actually use. */
export function resolveGenerationModel(config: {
  llm?: { model?: string } | undefined;
}): GenerationModelResolution {
  const explicitModel = asTrimmedString(config.llm?.model);
  const modelRef = explicitModel ?? DEFAULT_GENERATION_MODEL;
  const parsed = parseGenerationModelRef(modelRef);
  return {
    modelRef,
    modelId: parsed.modelId,
    provider: parsed.provider,
    explicit: explicitModel !== undefined,
  };
}

function collectModelIdFromEntry(entry: unknown): string | undefined {
  if (typeof entry === "string") return asTrimmedString(entry);
  if (!entry || typeof entry !== "object") return undefined;
  const record = entry as Record<string, unknown>;
  for (const key of MODEL_ID_KEYS) {
    const value = asTrimmedString(record[key]);
    if (value) return value;
  }
  return undefined;
}

function addModelRef(inventory: HostModelInventory, providerId: string | undefined, modelId: string): void {
  const id = modelId.trim();
  if (!id) return;
  inventory.refs.add(id.toLowerCase());
  if (providerId) {
    const p = providerId.trim().toLowerCase();
    inventory.providers.add(p);
    inventory.refs.add(`${p}/${id.toLowerCase()}`);
  }
}

function collectModelsContainer(
  inventory: HostModelInventory,
  providerId: string | undefined,
  models: unknown,
  source: string,
): void {
  let added = false;
  if (Array.isArray(models)) {
    for (const entry of models) {
      const id = collectModelIdFromEntry(entry);
      if (id) {
        addModelRef(inventory, providerId, id);
        added = true;
      }
    }
  } else if (models && typeof models === "object") {
    for (const [key, value] of Object.entries(models as Record<string, unknown>)) {
      const id = collectModelIdFromEntry(value) ?? asTrimmedString(key);
      if (id) {
        addModelRef(inventory, providerId, id);
        added = true;
      }
    }
  }
  if (added && !inventory.sources.includes(source)) inventory.sources.push(source);
}

/**
 * Read the HOST model inventory from already-materialised surfaces only.
 * Never performs I/O and never throws: every surface is probed defensively
 * because `api.runtime` is a throwing getter in some registration modes.
 */
export function resolveHostModelInventory(
  api: { config?: unknown; runtime?: unknown; modelCatalog?: unknown } | undefined,
): HostModelInventory {
  const inventory: HostModelInventory = {
    refs: new Set<string>(),
    providers: new Set<string>(),
    sources: [],
    confirmed: false,
  };
  if (!api || typeof api !== "object") return inventory;

  let hostConfig: Record<string, unknown> | undefined;
  try {
    hostConfig = (api as { config?: unknown }).config as Record<string, unknown> | undefined;
  } catch {
    hostConfig = undefined;
  }

  if (hostConfig && typeof hostConfig === "object") {
    const models = (hostConfig.models as Record<string, unknown> | undefined) ?? undefined;
    const providers = models?.providers as Record<string, unknown> | undefined;
    if (providers && typeof providers === "object") {
      for (const [providerId, providerConfig] of Object.entries(providers)) {
        inventory.providers.add(providerId.toLowerCase());
        if (providerConfig && typeof providerConfig === "object") {
          const modelsField = (providerConfig as Record<string, unknown>).models;
          if (modelsField !== undefined) {
            collectModelsContainer(inventory, providerId, modelsField, `config.models.providers.${providerId}.models`);
          } else {
            // Provider is declared but has no explicit model rows: the provider
            // id itself is known but no model refs are confirmed here.
            inventory.sources.push(`config.models.providers.${providerId}`);
          }
        }
      }
    }

    // Agent model bindings also prove a model is usable by this host.
    const agents = hostConfig.agents as Record<string, unknown> | undefined;
    const agentList = (agents?.list as unknown) ?? undefined;
    if (Array.isArray(agentList)) {
      for (const agent of agentList) {
        if (agent && typeof agent === "object") {
          const model = asTrimmedString((agent as Record<string, unknown>).model);
          if (model) {
            addModelRef(inventory, undefined, model);
            if (!inventory.sources.includes("config.agents.list[].model")) {
              inventory.sources.push("config.agents.list[].model");
            }
          }
        }
      }
    }
    const agentsDefaultsModel = asTrimmedString((agents?.defaults as Record<string, unknown> | undefined)?.model);
    if (agentsDefaultsModel) {
      addModelRef(inventory, undefined, agentsDefaultsModel);
      if (!inventory.sources.includes("config.agents.defaults.model")) inventory.sources.push("config.agents.defaults.model");
    }
    for (const key of ["model", "defaultModel"] as const) {
      const value = asTrimmedString(hostConfig[key]);
      if (value) {
        addModelRef(inventory, undefined, value);
        if (!inventory.sources.includes(`config.${key}`)) inventory.sources.push(`config.${key}`);
      }
    }
  }

  // Runtime surfaces (feature-detected; api.runtime throws in some modes).
  let runtime: Record<string, unknown> | undefined;
  try {
    runtime = (api as { runtime?: unknown }).runtime as Record<string, unknown> | undefined;
  } catch {
    runtime = undefined;
  }
  const runtimeCandidates: Array<[string, unknown]> = [];
  if (runtime && typeof runtime === "object") {
    runtimeCandidates.push(["runtime.models", runtime.models]);
    const llm = runtime.llm as Record<string, unknown> | undefined;
    if (llm && typeof llm === "object") runtimeCandidates.push(["runtime.llm.models", llm.models]);
  }
  let directCatalog: unknown;
  try {
    directCatalog = (api as { modelCatalog?: unknown }).modelCatalog;
  } catch {
    directCatalog = undefined;
  }
  runtimeCandidates.push(["modelCatalog", directCatalog]);

  for (const [source, surface] of runtimeCandidates) {
    if (!surface) continue;
    if (Array.isArray(surface)) {
      collectModelsContainer(inventory, undefined, surface, source);
      continue;
    }
    if (typeof surface === "function") {
      try {
        collectModelsContainer(inventory, undefined, (surface as () => unknown)(), source);
      } catch {
        /* ignore */
      }
      continue;
    }
    if (typeof surface === "object") {
      const record = surface as Record<string, unknown>;
      for (const key of ["list", "catalog", "entries", "all"] as const) {
        const candidate = record[key];
        if (typeof candidate === "function") {
          try {
            collectModelsContainer(inventory, undefined, (candidate as () => unknown)(), source);
          } catch {
            /* ignore */
          }
        } else if (candidate) {
          collectModelsContainer(inventory, undefined, candidate, source);
        }
      }
    }
  }

  inventory.confirmed = inventory.refs.size > 0;
  return inventory;
}

/**
 * Decide whether the effective generation model is usable on THIS host.
 *
 * "available"      — an inventory entry matched the model reference.
 * "unavailable"    — the inventory is confirmed and the model is absent (or its
 *                    provider is missing) → the feature must NOT run.
 * "unconfirmed"    — the host catalog could not be read → fail closed.
 */
export function evaluateGenerationModelAvailability(params: {
  inventory: HostModelInventory;
  model: GenerationModelResolution;
}): GenerationModelAvailability {
  const { inventory, model } = params;
  const inventorySource = inventory.sources.length > 0 ? inventory.sources.join(", ") : "none";
  const base = {
    inventorySource,
    inventorySize: inventory.refs.size,
  };

  if (!inventory.confirmed) {
    return {
      ...base,
      status: "unconfirmed",
      reason:
        "the host model inventory could not be read (no models.providers / runtime model catalog surfaced), "
        + "so availability of \"" + model.modelRef + "\" cannot be confirmed",
    };
  }

  const lowerRef = model.modelRef.toLowerCase();
  const lowerBare = model.modelId.toLowerCase();
  const candidates = new Set<string>([lowerRef, lowerBare]);
  if (model.provider) {
    candidates.add(`${model.provider}/${lowerBare}`);
  }

  // Provider-missing check has priority: a ref that names a provider the host
  // does not configure can never be served, even if a bare id collides.
  if (model.provider && inventory.providers.size > 0 && !inventory.providers.has(model.provider)) {
    if (!inventory.refs.has(lowerRef)) {
      return {
        ...base,
        status: "unavailable",
        reason:
          "provider \"" + model.provider + "\" is not configured on this host "
          + "(configured providers: " + Array.from(inventory.providers).sort().join(", ") + ")",
      };
    }
  }

  for (const candidate of candidates) {
    if (inventory.refs.has(candidate)) {
      return {
        ...base,
        status: "available",
        matchedRef: candidate,
        reason: "matched host catalog entry \"" + candidate + "\"",
      };
    }
  }

  return {
    ...base,
    status: "unavailable",
    reason:
      "the host model inventory (" + inventory.refs.size + " entr"
      + (inventory.refs.size === 1 ? "y" : "ies") + ") does not contain \"" + model.modelRef + "\"",
  };
}

/**
 * Load-time safety snapshot surfaced through `memory-cip doctor`.
 * Every field is a *conclusion*, not a promise.
 */
export interface LoadSafetyReport {
  /** Effective generation model reference for smart extraction. */
  generationModel: string;
  /** Whether llm.model was explicitly configured. */
  generationModelExplicit: boolean;
  /** available | unavailable | unconfirmed. */
  generationModelStatus: ModelAvailabilityStatus;
  /** Readable reason for the status. */
  generationModelReason: string;
  /** Which host surface supplied the inventory (or "none"). */
  modelInventorySource: string;
  /** Number of catalog refs read from the host. */
  modelInventorySize: number;
  /** smartExtraction as requested by config. */
  smartExtractionRequested: boolean;
  /** Whether smart extraction is actually active after the availability gate. */
  smartExtractionActive: boolean;
  /** Why smart extraction is inactive (undefined when active). */
  smartExtractionDisabledReason?: string;
  /** Conclusion for the zero-network-at-load invariant. */
  loadTimeNetwork: "none";
  /** Wall-clock ms spent in the synchronous load/init phase. */
  loadDurationMs: number;
  /** Threshold (ms) above which load warns. */
  loadWarnAfterMs: number;
  /** Embedding model reference (informational). */
  embeddingModel: string;
  /** Embedding provider id (informational). */
  embeddingProvider: string;
}

export function formatLoadSafetyLines(report: LoadSafetyReport): string[] {
  const yesNo = (value: boolean) => (value ? "yes" : "no");
  return [
    `  load safety: network-at-load=${report.loadTimeNetwork} (register() is synchronous; no warmup, no LLM probe)`,
    `    load phase: ${report.loadDurationMs}ms (warn threshold ${report.loadWarnAfterMs}ms)`,
    `  embedding: model=${report.embeddingModel} provider=${report.embeddingProvider} (lazy; never contacted at load)`,
    `  generation LLM: model=${report.generationModel}` +
      ` explicit=${yesNo(report.generationModelExplicit)} available=${report.generationModelStatus}`,
    `    reason: ${report.generationModelReason}`,
    `    host inventory: source=${report.modelInventorySource} entries=${report.modelInventorySize}`,
    `  smartExtraction: requested=${yesNo(report.smartExtractionRequested)} effective=${yesNo(report.smartExtractionActive)}`,
    ...(report.smartExtractionDisabledReason
      ? [`    disabled because: ${report.smartExtractionDisabledReason}`]
      : []),
  ];
}
