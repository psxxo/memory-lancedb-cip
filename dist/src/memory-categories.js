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
];
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
};
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
];
/** Every accepted input token: the 10 canonical names plus the 5 aliases. */
export const TOOL_MEMORY_CATEGORIES = [
    ...MEMORY_CATEGORIES,
    ...MEMORY_CATEGORY_ALIAS_NAMES,
];
/**
 * Pre-migration column/input values that are no longer canonical names. They
 * survive only as read-side tolerance for rows written by older builds; new
 * writes never use them. ("fact"/"decision"/"reflection"/"other" used to live
 * here too and are canonical categories now.)
 */
export const LEGACY_MEMORY_CATEGORIES = MEMORY_CATEGORY_ALIAS_NAMES;
/**
 * Thrown/returned when a write asks for a category that is neither canonical
 * nor an accepted alias. Callers must reject the write rather than silently
 * landing the row in a fallback category.
 */
/**
 * Compose the "what may I send instead" half of a rejection message. The
 * canonical names and the accepted aliases are labelled separately so a caller
 * can re-issue with a valid value on the first retry: aliases are shown next to
 * the canonical name they fold onto.
 */
function describeAllowedCategories(allowed) {
    const aliasByToken = MEMORY_CATEGORY_ALIASES;
    const canonical = allowed.filter((token) => MEMORY_CATEGORIES.includes(token));
    const aliases = allowed.filter((token) => token in aliasByToken);
    const parts = [];
    if (canonical.length > 0) {
        parts.push(`Canonical categories: ${canonical.join(", ")}`);
    }
    if (aliases.length > 0) {
        parts.push(`accepted aliases: ${aliases
            .map((token) => `${token} -> ${aliasByToken[token]}`)
            .join(", ")}`);
    }
    return parts.join("; ");
}
export class InvalidMemoryCategoryError extends Error {
    code = "invalid_memory_category";
    rawCategory;
    allowed;
    constructor(rawCategory, allowed = TOOL_MEMORY_CATEGORIES) {
        super(`Invalid memory category "${rawCategory}". ${describeAllowedCategories(allowed)}. ` +
            "Unknown names are rejected; they are never silently coerced.");
        this.name = "InvalidMemoryCategoryError";
        this.rawCategory = rawCategory;
        this.allowed = allowed;
    }
}
/** Categories that always merge (skip dedup entirely). */
export const ALWAYS_MERGE_CATEGORIES = new Set(["profile"]);
/** Categories that support MERGE decision from LLM dedup. */
export const MERGE_SUPPORTED_CATEGORIES = new Set([
    "preferences",
    "entities",
    "patterns",
    "fact",
    "reflection",
]);
/** Categories whose facts can be replaced over time without deleting history. */
export const TEMPORAL_VERSIONED_CATEGORIES = new Set([
    "preferences",
    "entities",
    "fact",
]);
/** Categories that are append-only (CREATE or SKIP only, no MERGE). */
export const APPEND_ONLY_CATEGORIES = new Set([
    "events",
    "cases",
    "decision",
]);
/**
 * Durable categories: governs fiction-register batch enforcement (an
 * in-fiction batch can never produce durable memories) and the batch
 * contradiction check. Per-item grounding "constructed" is dropped
 * unconditionally in every category, so this set does not gate that rule.
 *
 * Every canonical category is durable except "other", the non-durable
 * catch-all.
 */
export const DURABLE_CATEGORIES = new Set([
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
export const FICTION_JUDGED_CATEGORIES = new Set(["events"]);
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
export const FICTION_UNCONDITIONAL_DROP_CATEGORIES = new Set([...DURABLE_CATEGORIES].filter((category) => !FICTION_JUDGED_CATEGORIES.has(category)));
/** Register strictness ordering; a rejudge verdict may tighten, never relax, on partial coverage. */
export const REGISTER_STRICTNESS = {
    real: 0,
    mixed: 1,
    fiction: 2,
};
/** Validate and normalize a category string. Returns null for unknown input. */
export function normalizeCategory(raw) {
    const lower = String(raw ?? "").toLowerCase().trim();
    if (!lower)
        return null;
    const aliased = MEMORY_CATEGORY_ALIASES[lower] ?? lower;
    if (MEMORY_CATEGORIES.includes(aliased)) {
        return aliased;
    }
    return null;
}
export function matchesMemoryCategoryFilter(entryCategory, requestedCategory, entryMetadata) {
    const rawEntryCategory = String(entryCategory ?? "").toLowerCase().trim();
    const rawRequestedCategory = String(requestedCategory ?? "").toLowerCase().trim();
    if (rawEntryCategory === rawRequestedCategory)
        return true;
    const normalizedRequestedCategory = normalizeCategory(rawRequestedCategory);
    if (!normalizedRequestedCategory)
        return false;
    // A valid stamped memory_category is authoritative over the column value for
    // historical rows (old builds could write either vocabulary into the column).
    const metadataCategory = extractMetadataMemoryCategory(entryMetadata);
    if (metadataCategory) {
        return metadataCategory === normalizedRequestedCategory;
    }
    const normalizedEntryCategory = normalizeCategory(rawEntryCategory);
    return normalizedEntryCategory === normalizedRequestedCategory;
}
export function resolveCategoryFilterCandidates(requestedCategory) {
    const rawRequestedCategory = String(requestedCategory ?? "").toLowerCase().trim();
    const normalizedRequestedCategory = normalizeCategory(rawRequestedCategory);
    const candidates = new Set([rawRequestedCategory]);
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
export function getStorageCategoryForMemoryCategory(category) {
    // Identity: the canonical category name is what the storage column holds.
    return category;
}
export function resolveToolMemoryCategory(rawCategory) {
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
export function isToolMemoryCategoryError(resolution) {
    return !resolution.ok;
}
/** Every value `--unknown` accepts, for help and error text. */
export const UNKNOWN_CATEGORY_POLICIES = [
    "reject",
    ...MEMORY_CATEGORIES,
];
/**
 * Narrowing helper (boolean-literal discriminating narrowing is disabled under
 * this repo's `strictNullChecks: false`).
 */
export function isUnknownCategoryPolicyError(parsed) {
    return !parsed.ok;
}
/** Validate an `--unknown` option value. Unknown policies are rejected loudly. */
export function parseUnknownCategoryPolicy(raw) {
    const lower = String(raw ?? "").toLowerCase().trim();
    if (lower === "reject") {
        return { ok: true, policy: "reject" };
    }
    if (MEMORY_CATEGORIES.includes(lower)) {
        return { ok: true, policy: lower };
    }
    return {
        ok: false,
        message: `Unknown --unknown policy ${JSON.stringify(String(raw ?? ""))}. ` +
            `Use "reject" (skip the row; the default), "other", or a canonical category: ${MEMORY_CATEGORIES.join(", ")}.`,
    };
}
/**
 * Resolve one import row's category under the operator's policy. Returns the
 * decision AND the layer that made it, so the caller can report the plan
 * instead of applying an invisible coercion.
 */
export function resolveImportCategory(raw, options = {}) {
    const unknownPolicy = options.unknownPolicy ?? "reject";
    const categoryMap = options.categoryMap ?? {};
    const requested = raw === undefined || raw === null || String(raw).trim() === "" ? null : String(raw);
    const lower = requested === null ? "" : requested.toLowerCase().trim();
    // 1. No category supplied: keep the documented "other" default.
    if (!lower) {
        return {
            requested,
            resolution: "default",
            category: "other",
            via: "default",
            stored: true,
        };
    }
    // 2. Exact canonical name.
    if (MEMORY_CATEGORIES.includes(lower)) {
        return {
            requested,
            resolution: "canonical",
            category: lower,
            via: "name",
            stored: true,
        };
    }
    // 3. Built-in singular/plural alias.
    const alias = MEMORY_CATEGORY_ALIASES[lower];
    if (alias) {
        return {
            requested,
            resolution: "aliased",
            category: alias,
            via: "alias",
            stored: true,
        };
    }
    // 4. Operator-supplied `--category-map` entry.
    const mapped = categoryMap[lower];
    if (mapped !== undefined) {
        const normalized = normalizeCategory(String(mapped));
        if (normalized) {
            return {
                requested,
                resolution: "mapped",
                category: normalized,
                via: "category-map",
                stored: true,
            };
        }
    }
    // 5. Still unresolved: only the operator's explicit `--unknown` policy decides.
    if (unknownPolicy === "reject") {
        return {
            requested,
            resolution: "rejected",
            category: null,
            via: "unknown-policy",
            stored: false,
        };
    }
    if (unknownPolicy === "other") {
        return {
            requested,
            resolution: "other",
            category: "other",
            via: "unknown-policy",
            stored: true,
        };
    }
    return {
        requested,
        resolution: "mapped",
        category: unknownPolicy,
        via: "unknown-policy",
        stored: true,
    };
}
/** Human-readable one-line description of an import category resolution. */
export function describeImportCategoryResolution(resolution) {
    switch (resolution.resolution) {
        case "canonical":
            return `canonical -> ${resolution.category}`;
        case "aliased":
            return `aliased -> ${resolution.category}`;
        case "mapped":
            return resolution.via === "unknown-policy"
                ? `mapped by --unknown -> ${resolution.category}`
                : `mapped by --category-map -> ${resolution.category}`;
        case "other":
            return "other (explicit --unknown=other) -> other";
        case "default":
            return "default (no category field) -> other";
        case "rejected":
            return "rejected (--unknown=reject) -> row skipped";
    }
}
/** Narrowing helper (see `isUnknownCategoryPolicyError`). */
export function isImportCategoryMapError(validation) {
    return !validation.ok;
}
/**
 * Validate a parsed `--category-map` document: a JSON object whose keys are
 * arbitrary input names and whose values are canonical categories (aliases are
 * accepted and folded). Any invalid entry fails the whole file, loudly.
 */
export function validateImportCategoryMap(value) {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
        return {
            ok: false,
            message: 'Category map must be a JSON object mapping input names to canonical categories, e.g. {"lemmas":"cases"}.',
        };
    }
    const map = {};
    const invalid = [];
    for (const [key, rawValue] of Object.entries(value)) {
        const normalizedKey = String(key).toLowerCase().trim();
        const normalizedValue = normalizeCategory(String(rawValue ?? ""));
        if (!normalizedKey || !normalizedValue) {
            invalid.push(`${JSON.stringify(key)} -> ${JSON.stringify(rawValue)}`);
            continue;
        }
        map[normalizedKey] = normalizedValue;
    }
    if (invalid.length > 0) {
        return {
            ok: false,
            message: `Category map has ${invalid.length} invalid entr${invalid.length === 1 ? "y" : "ies"} ` +
                `(values must be a canonical category or an accepted alias): ${invalid.join(", ")}. ` +
                `Canonical categories: ${MEMORY_CATEGORIES.join(", ")}. ` +
                `Accepted aliases: ${MEMORY_CATEGORY_ALIAS_NAMES.join(", ")}.`,
        };
    }
    return { ok: true, map };
}
function extractMetadataMemoryCategory(rawMetadata) {
    if (!rawMetadata)
        return null;
    try {
        const parsed = JSON.parse(rawMetadata);
        if (typeof parsed.memory_category !== "string")
            return null;
        return normalizeCategory(parsed.memory_category);
    }
    catch {
        return null;
    }
}
