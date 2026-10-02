import { normalizeRawBlockIds } from "./provenance.js";
/**
 * Drill-down decision for the two-tier recall (see RAW-FIRST-DESIGN.md).
 *
 * Recall answers from the summary tier by default. The raw tier is reached
 * only on deterministic triggers:
 *   - an explicit request for the exact words, a quote, or the full detail
 *   - a time reference or a quote reference in the query
 *   - an empty or low-confidence summary hit
 * A model may be a fallback for the genuinely ambiguous band, never the sole
 * gate: model-dependent steps are exactly where this system has broken before
 * (26 turn-start drains, 0 created on 2026-10-02).
 */
export const DEFAULT_LOW_CONFIDENCE_THRESHOLD = 0.35;
export const DEFAULT_HIGH_CONFIDENCE_THRESHOLD = 0.6;
/** Explicit ask for exact wording, a quote, or full detail. */
const EXACT_DETAIL_PATTERN = /(原话|原句|原文|逐字|一字不差|一字不漏|全文|完整(?:的)?(?:内容|原文|文字|记录|版本)|详细(?:内容|信息|经过|情况|细节)|具体(?:内容|细节)|原原本本|引用(?:一下|原文)?|怎么说的|说过(?:什么|的话)|说了什么|提过什么)|\b(exact(?:ly)?\s+(?:the\s+)?words?|verbatim|word\s+for\s+word|quot(?:e|ed|ation)|full\s+(?:text|detail|version)|in\s+full|transcript|what\s+(?:did|does)\s+\S+\s+say)\b/i;
/** A quoted span in the query (straight or CJK quotes) is a quote reference. */
const QUOTE_REFERENCE_PATTERN = /[""][^""]{2,}[""]|「[^「」]{2,}」|『[^『』]{2,}』|"[^"]{2,}"/;
/** A time reference ("when did ...", "yesterday", "2026-10-01", "上周"). */
const TIME_REFERENCE_PATTERN = /(昨天|前天|今天|今晚|昨晚|上周|上星期|上个月|去年|那天|当时|那次|上次|几点|什么时候|几号|多久|刚刚|刚才|之前|后来)|\b(yesterday|today|tonight|last\s+(?:night|week|month|year)|this\s+(?:morning|afternoon|evening)|the\s+other\s+day|earlier|\d{4}-\d{2}-\d{2}|\d{1,2}:\d{2})\b/i;
/** Collect the provenance link of every summary hit into one id list. */
export function collectProvenanceRawBlockIds(hits) {
    const ids = [];
    for (const hit of hits ?? []) {
        for (const id of normalizeRawBlockIds(hit?.rawBlockIds)) {
            ids.push(id);
        }
    }
    const seen = new Set();
    const unique = [];
    for (const id of ids) {
        if (seen.has(id))
            continue;
        seen.add(id);
        unique.push(id);
    }
    return unique;
}
export function matchesExactDetailRequest(query) {
    return EXACT_DETAIL_PATTERN.test(query);
}
export function matchesQuoteReference(query) {
    return QUOTE_REFERENCE_PATTERN.test(query);
}
export function matchesTimeReference(query) {
    return TIME_REFERENCE_PATTERN.test(query);
}
/**
 * Pure decision: should this recall drill into the raw tier? Deterministic
 * triggers are evaluated before any confidence-based one, and the model is
 * only ever surfaced as a fallback for the ambiguous band.
 */
export function decideDrillDown(input) {
    const query = typeof input?.query === "string" ? input.query : "";
    const hits = Array.isArray(input?.summaryHits)
        ? input.summaryHits.filter((hit) => Boolean(hit))
        : [];
    const low = input?.lowConfidenceThreshold ?? DEFAULT_LOW_CONFIDENCE_THRESHOLD;
    const high = input?.highConfidenceThreshold ?? DEFAULT_HIGH_CONFIDENCE_THRESHOLD;
    const hasRawTier = input?.hasRawTier !== false;
    if (!hasRawTier) {
        return { drill: false, reason: "no-raw-tier", mode: "none", rawBlockIds: [] };
    }
    const provenanceIds = collectProvenanceRawBlockIds(hits);
    const deterministic = (reason) => ({
        drill: true,
        reason,
        mode: "deterministic",
        rawBlockIds: provenanceIds,
    });
    // 1. Deterministic wording triggers, independent of summary confidence.
    if (matchesExactDetailRequest(query))
        return deterministic("explicit-detail-request");
    if (matchesQuoteReference(query))
        return deterministic("quote-reference");
    if (matchesTimeReference(query))
        return deterministic("time-reference");
    // 2. Empty or low-confidence summary hit.
    if (hits.length === 0) {
        return { drill: true, reason: "empty-summary", mode: "deterministic", rawBlockIds: [] };
    }
    const topScore = Number(hits[0].score);
    if (Number.isFinite(topScore) && topScore < low) {
        return deterministic("low-confidence-summary");
    }
    // 3. Model fallback for the ambiguous band only.
    if (Number.isFinite(topScore) && topScore < high && input?.modelFallbackAvailable === true) {
        return { drill: true, reason: "model-fallback", mode: "model", rawBlockIds: provenanceIds };
    }
    return { drill: false, reason: "summary-sufficient", mode: "none", rawBlockIds: [] };
}
/** One log line per recall decision (see RAW-FIRST-DESIGN.md). */
export function formatDrillDownLog(decision, context = {}) {
    const top = typeof context.topScore === "number" && Number.isFinite(context.topScore)
        ? context.topScore.toFixed(3)
        : "n/a";
    return (`memory-lancedb-cip: drill-down drill=${decision.drill} mode=${decision.mode} ` +
        `reason=${decision.reason} hits=${context.hitCount ?? 0} topScore=${top} ` +
        `rawBlocks=[${decision.rawBlockIds.join(",")}]`);
}
