/**
 * Memory Categories — 10-category taxonomy (plan B: a single vocabulary)
 *
 * Canonical categories (one-to-one): profile, preferences, entities, events,
 * cases, patterns, decision, fact, reflection, other.
 *
 * The canonical name IS what gets persisted in the storage `category` column.
 * The old double layer (a 6-category semantic vocabulary kept in metadata plus
 * a separate legacy storage vocabulary in the column, joined by a lossy map)
 * is gone: the smart→storage map is the identity. Rows written by older builds
 * still carry the singular aliases ("preference", "entity") or the canonical
 * values; reads fold the aliases onto their canonical plural form, and every
 * new write persists the canonical name.
 */

export const MEMORY_CATEGORIES = [
  "profile",
  "preferences",
  "entities",
  "events",
  "cases",
  "patterns",
  "decision",
  "fact",
  "reflection",
  "other",
] as const;

export type MemoryCategory = (typeof MEMORY_CATEGORIES)[number];

/**
 * Accepted input aliases (singular/plural only). Every alias normalizes to its
 * canonical category before anything is written, so the alias token itself is
 * never persisted.
 */
export const MEMORY_CATEGORY_ALIASES = {
  preference: "preferences",
  entity: "entities",
  event: "events",
  case: "cases",
  pattern: "patterns",
} as const satisfies Record<string, MemoryCategory>;

export type MemoryCategoryAlias = keyof typeof MEMORY_CATEGORY_ALIASES;

/**
 * Alias tokens as an explicit tuple (not `Object.keys`) so the TypeBox tool
 * schema keeps a literal union instead of degrading to `string`.
 */
export const MEMORY_CATEGORY_ALIAS_NAMES = [
  "preference",
  "entity",
  "event",
  "case",
  "pattern",
] as const;

/** Every accepted input token: the 10 canonical names plus the 5 aliases. */
export const TOOL_MEMORY_CATEGORIES = [
  ...MEMORY_CATEGORIES,
  ...MEMORY_CATEGORY_ALIAS_NAMES,
] as const;

/**
 * Pre-migration column/input values that are no longer canonical names. They
 * survive only as read-side tolerance for rows written by older builds; new
 * writes never use them. ("fact"/"decision"/"reflection"/"other" used to live
 * here too and are canonical categories now.)
 */
export const LEGACY_MEMORY_CATEGORIES = MEMORY_CATEGORY_ALIAS_NAMES;
export type LegacyMemoryCategory = (typeof LEGACY_MEMORY_CATEGORIES)[number];

/**
 * Any value the storage `category` column may legitimately contain: the 10
 * canonical names, plus the singular aliases still present on rows written by
 * older builds (which the read path folds onto the canonical name).
 */
export type StoredMemoryCategory = MemoryCategory | LegacyMemoryCategory;

/**
 * The storage column speaks the canonical vocabulary, so the storage category
 * type is exactly the canonical category type (identity map).
 */
export type SmartStorageCategory = MemoryCategory;

/**
 * Thrown/returned when a write asks for a category that is neither canonical
 * nor an accepted alias. Callers must reject the write rather than silently
 * landing the row in a fallback category.
 */
export class InvalidMemoryCategoryError extends Error {
  readonly code = "invalid_memory_category";
  readonly rawCategory: string;
  readonly allowed: readonly string[];

  constructor(rawCategory: string, allowed: readonly string[] = TOOL_MEMORY_CATEGORIES) {
    super(`Invalid memory category "${rawCategory}". Allowed: ${allowed.join(", ")}`);
    this.name = "InvalidMemoryCategoryError";
    this.rawCategory = rawCategory;
    this.allowed = allowed;
  }
}

/** Categories that always merge (skip dedup entirely). */
export const ALWAYS_MERGE_CATEGORIES = new Set<MemoryCategory>(["profile"]);

/** Categories that support MERGE decision from LLM dedup. */
export const MERGE_SUPPORTED_CATEGORIES = new Set<MemoryCategory>([
  "preferences",
  "entities",
  "patterns",
  "fact",
  "reflection",
]);

/** Categories whose facts can be replaced over time without deleting history. */
export const TEMPORAL_VERSIONED_CATEGORIES = new Set<MemoryCategory>([
  "preferences",
  "entities",
  "fact",
]);

/** Categories that are append-only (CREATE or SKIP only, no MERGE). */
export const APPEND_ONLY_CATEGORIES = new Set<MemoryCategory>([
  "events",
  "cases",
  "decision",
]);

/** Memory tier levels for lifecycle management. */
export type MemoryTier = "core" | "working" | "peripheral";

/** Per-candidate conversational grounding self-tag from extraction. */
export type CandidateGrounding = "real" | "constructed";

/**
 * Batch-level register judgment for the whole extraction input:
 * "real" ordinary conversation, "fiction" an in-character/game/roleplay
 * frame, "mixed" both interleaved. Judged once per extraction batch —
 * more stable than the per-item grounding tags.
 */
export type ConversationRegister = "real" | "mixed" | "fiction";

/**
 * Durable categories: governs fiction-register batch enforcement (an
 * in-fiction batch can never produce durable memories) and the batch
 * contradiction check. Per-item grounding "constructed" is dropped
 * unconditionally in every category, so this set does not gate that rule.
 *
 * Every canonical category is durable except "other", the non-durable
 * catch-all.
 */
export const DURABLE_CATEGORIES = new Set<MemoryCategory>([
  "profile",
  "preferences",
  "entities",
  "events",
  "cases",
  "patterns",
  "decision",
  "fact",
  "reflection",
]);

/**
 * Judge-gated categories: durable, but ambiguous enough inside a
 * fiction-register batch that the per-item self-tag cannot be trusted.
 * An event may be an assertion ABOUT a fiction session ("we played for three
 * hours") or one from WITHIN it ("boarded the train to the capital"); both
 * arrive tagged grounding="real" when the model mis-registers the second.
 * In a fiction batch these survive only on positive grounding-judge
 * confirmation, so a missing, partial, or failed verdict fails closed.
 * They are therefore excluded from FICTION_UNCONDITIONAL_DROP_CATEGORIES:
 * every other durable category is dropped outright and never reaches this gate.
 */
export const FICTION_JUDGED_CATEGORIES = new Set<MemoryCategory>(["events"]);

/**
 * Durable categories that an in-fiction batch drops outright.
 *
 * Fiction-judged categories ("events") are durable too, but they are NOT
 * dropped by the register rule: an event may be a TRUE assertion ABOUT a
 * fiction session ("we played for three hours"), so it survives only on a
 * positive grounding-judge confirmation — the same fail-closed gate an
 * ambiguous category gets. Every other durable category is dropped
 * unconditionally in a fiction-register batch.
 */
export const FICTION_UNCONDITIONAL_DROP_CATEGORIES = new Set<MemoryCategory>(
  [...DURABLE_CATEGORIES].filter(
    (category) => !FICTION_JUDGED_CATEGORIES.has(category),
  ),
);

/** Register strictness ordering; a rejudge verdict may tighten, never relax, on partial coverage. */
export const REGISTER_STRICTNESS: Record<ConversationRegister, number> = {
  real: 0,
  mixed: 1,
  fiction: 2,
};

/** A candidate memory extracted from conversation by LLM. */
export type CandidateMemory = {
  category: MemoryCategory;
  abstract: string; // L0: one-sentence index
  overview: string; // L1: structured markdown summary
  content: string; // L2: full narrative
  /** Absent on legacy payloads: treat as "real" (fail open per item). */
  grounding?: CandidateGrounding;
  /** Batch register the candidate was extracted under; absent on legacy payloads. */
  conversationRegister?: ConversationRegister;
};

/** Dedup decision from LLM. */
export type DedupDecision =
  | "create"
  | "merge"
  | "skip"
  | "support"
  | "contextualize"
  | "contradict"
  | "supersede";

export type DedupResult = {
  decision: DedupDecision;
  reason: string;
  matchId?: string; // ID of existing memory to merge with
  contextLabel?: string; // Optional context label for support/contextualize/contradict
};

export type ExtractionStats = {
  created: number;
  merged: number;
  skipped: number;
  rejected?: number; // admission control rejections
  boundarySkipped?: number;
  supported?: number; // context-aware support count
  superseded?: number; // temporal fact replacements
  /**
   * True when the candidate extraction never produced a usable result (null or
   * malformed LLM completion). Distinguishes "the LLM judged nothing worth
   * storing" (a definitive zero) from "the LLM never answered" — callers must
   * not consume deferred input on the latter.
   */
  extractionFailed?: boolean;
  /**
   * True when at least one candidate reached a definitive pipeline verdict
   * (create, merge, admission reject, dedup skip, support, or supersede).
   * A zero-persisted run with settled outcomes is CONSUMED input, not a
   * retryable one: requeuing it re-runs extraction and admission on the same
   * snapshot, duplicates rejection audits or support evidence, and charges
   * the rate limiter again. Absent/false means the run was barren (no
   * candidates) or failed — the only retryable shapes.
   */
  settledOutcomes?: boolean;
  skippedNoInput?: boolean; // nothing extractable survived stripping/bounding: no LLM call was made
};

/** Validate and normalize a category string. Returns null for unknown input. */
export function normalizeCategory(raw: string): MemoryCategory | null {
  const lower = String(raw ?? "").toLowerCase().trim();
  if (!lower) return null;
  const aliased =
    (MEMORY_CATEGORY_ALIASES as Record<string, MemoryCategory>)[lower] ?? lower;
  if ((MEMORY_CATEGORIES as readonly string[]).includes(aliased)) {
    return aliased as MemoryCategory;
  }
  return null;
}

export function matchesMemoryCategoryFilter(
  entryCategory: string,
  requestedCategory: string,
  entryMetadata?: string,
): boolean {
  const rawEntryCategory = String(entryCategory ?? "").toLowerCase().trim();
  const rawRequestedCategory = String(requestedCategory ?? "").toLowerCase().trim();
  if (rawEntryCategory === rawRequestedCategory) return true;

  const normalizedRequestedCategory = normalizeCategory(rawRequestedCategory);
  if (!normalizedRequestedCategory) return false;

  // A valid stamped memory_category is authoritative over the column value for
  // historical rows (old builds could write either vocabulary into the column).
  const metadataCategory = extractMetadataMemoryCategory(entryMetadata);
  if (metadataCategory) {
    return metadataCategory === normalizedRequestedCategory;
  }

  const normalizedEntryCategory = normalizeCategory(rawEntryCategory);
  return normalizedEntryCategory === normalizedRequestedCategory;
}

export function resolveCategoryFilterCandidates(requestedCategory: string): string[] {
  const rawRequestedCategory = String(requestedCategory ?? "").toLowerCase().trim();
  const normalizedRequestedCategory = normalizeCategory(rawRequestedCategory);
  const candidates = new Set<string>([rawRequestedCategory]);

  if (normalizedRequestedCategory) {
    candidates.add(normalizedRequestedCategory);
    for (const category of TOOL_MEMORY_CATEGORIES) {
      if (normalizeCategory(category) === normalizedRequestedCategory) {
        candidates.add(category);
      }
    }
  }

  return [...candidates];
}

export function getStorageCategoryForMemoryCategory(
  category: MemoryCategory,
): SmartStorageCategory {
  // Identity: the canonical category name is what the storage column holds.
  return category;
}

/**
 * Resolve a tool/CLI category token into its canonical category.
 *
 * An unrecognized token is NOT silently mapped to a fallback (the old code
 * returned patterns/other): it yields a typed validation error so callers
 * must reject the write.
 */
export type ToolMemoryCategoryResolution =
  | {
      ok: true;
      /** Canonical category name, exactly what is persisted in the column. */
      memoryCategory: MemoryCategory;
      /** Storage column value: identical to the canonical name. */
      storageCategory: SmartStorageCategory;
    }
  | {
      ok: false;
      error: InvalidMemoryCategoryError;
    };

export function resolveToolMemoryCategory(rawCategory: string): ToolMemoryCategoryResolution {
  const raw = String(rawCategory ?? "").toLowerCase().trim();
  const normalized = normalizeCategory(raw);
  if (!normalized) {
    return { ok: false, error: new InvalidMemoryCategoryError(String(rawCategory ?? "")) };
  }
  return {
    ok: true,
    memoryCategory: normalized,
    storageCategory: getStorageCategoryForMemoryCategory(normalized),
  };
}

/**
 * Narrowing helper for the resolution union. A user-defined type predicate is
 * used instead of `if (!resolution.ok)` because boolean-literal discriminant
 * narrowing is disabled under this repo's `strictNullChecks: false`.
 */
export type ToolMemoryCategoryError = Extract<ToolMemoryCategoryResolution, { ok: false }>;
export type ToolMemoryCategoryResolutionOk = Extract<ToolMemoryCategoryResolution, { ok: true }>;

export function isToolMemoryCategoryError(
  resolution: ToolMemoryCategoryResolution,
): resolution is ToolMemoryCategoryError {
  return !resolution.ok;
}

function extractMetadataMemoryCategory(rawMetadata?: string): MemoryCategory | null {
  if (!rawMetadata) return null;
  try {
    const parsed = JSON.parse(rawMetadata) as { memory_category?: unknown };
    if (typeof parsed.memory_category !== "string") return null;
    return normalizeCategory(parsed.memory_category);
  } catch {
    return null;
  }
}
