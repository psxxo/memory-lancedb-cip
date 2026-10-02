/**
 * Provenance for the summary tier (see RAW-FIRST-DESIGN.md).
 *
 * A distilled entry is derived from one or more raw blocks. The link back to
 * those block ids is MANDATORY: without it drill-down is impossible and the
 * summary silently becomes the only record. A distilled entry that cannot name
 * its raw block is invalid and must not be stored.
 */
export class MissingProvenanceError extends Error {
    reason;
    rawBlockIds;
    constructor(reason, message) {
        super(message);
        this.name = "MissingProvenanceError";
        this.reason = reason;
        this.rawBlockIds = [];
    }
}
/** Accept a string, a string array, or an iterable of strings; keep non-empty. */
export function normalizeRawBlockIds(value) {
    const raw = Array.isArray(value)
        ? value
        : typeof value === "string"
            ? value.split(",")
            : [];
    const seen = new Set();
    const ids = [];
    for (const item of raw) {
        if (typeof item !== "string")
            continue;
        const id = item.trim();
        if (id.length === 0 || seen.has(id))
            continue;
        seen.add(id);
        ids.push(id);
    }
    return ids;
}
/**
 * Validate that a distilled entry carries usable provenance. Returns the
 * normalized id list so the caller can store it alongside the summary.
 */
export function validateDistilledProvenance(entry) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
        return { valid: false, reason: "not-an-object", rawBlockIds: [] };
    }
    const candidate = entry;
    if (candidate.rawBlockIds === undefined || candidate.rawBlockIds === null) {
        return { valid: false, reason: "empty-provenance", rawBlockIds: [] };
    }
    const rawBlockIds = normalizeRawBlockIds(candidate.rawBlockIds);
    if (rawBlockIds.length === 0) {
        return { valid: false, reason: "empty-provenance", rawBlockIds: [] };
    }
    return { valid: true, rawBlockIds };
}
export function hasDistilledProvenance(entry) {
    return validateDistilledProvenance(entry).valid;
}
/**
 * Throw unless the entry carries provenance. Use at every write boundary of
 * the summary tier so an unlinked distilled entry can never be persisted.
 */
export function assertDistilledProvenance(entry) {
    const validation = validateDistilledProvenance(entry);
    if (!validation.valid) {
        throw new MissingProvenanceError(validation.reason ?? "invalid-provenance", "distilled entry is missing raw-block provenance and must not be stored");
    }
    return validation.rawBlockIds;
}
/** Stamp provenance onto an entry, normalizing and de-duplicating the ids. */
export function withProvenance(entry, rawBlockIds) {
    const ids = normalizeRawBlockIds(rawBlockIds);
    if (ids.length === 0) {
        throw new MissingProvenanceError("empty-provenance", "distilled entry is missing raw-block provenance and must not be stored");
    }
    return { ...entry, rawBlockIds: ids };
}
/**
 * Read provenance back out of a stored metadata JSON string. Returns an empty
 * list when the metadata is missing, malformed, or carries no link (older
 * entries predate the raw tier and stay readable without a link).
 */
export function parseRawBlockIdsFromMetadata(metadata) {
    if (typeof metadata !== "string" || metadata.trim().length === 0)
        return [];
    try {
        const parsed = JSON.parse(metadata);
        return normalizeRawBlockIds(parsed.rawBlockIds ?? parsed.raw_block_ids ?? parsed.provenance);
    }
    catch {
        return [];
    }
}
