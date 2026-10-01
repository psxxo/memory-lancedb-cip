/**
 * Turn-start extraction drain — decision logic.
 *
 * The extraction lane cannot call the host model from a finished turn: the
 * host authorizes a plugin completion against the live run, so the agent_end
 * lane can only QUEUE the texts (see EXTRACTION-LANE.md). The primary lane
 * implemented here drains a session's queue when that session's NEXT turn
 * starts, i.e. while a host-owned run is demonstrably live, so the completion
 * has a chance of being authorized like any other in-turn model call.
 *
 * The decision is separated from the hook so the gating rules are unit
 * testable without a host: only drain when smart extraction is available, the
 * turn names a session, that session actually has queued texts, no drain is
 * already running, and the hourly extraction budget is not exhausted.
 *
 * The drain itself stays bounded: the hook drains exactly ONE session (the
 * speaking one) and the caller runs it concurrently with the reply instead of
 * blocking it.
 */
/** Default spacing between turn-start drains for one session (0 = every turn). */
export const DEFAULT_TURN_START_DRAIN_MIN_INTERVAL_MS = 0;
/** Pure decision: should this turn start drain its own session's queue? */
export function decideTurnStartDrain(input) {
    if (!input.smartExtractionEnabled)
        return { drain: false, reason: "disabled" };
    // The scheduled extraction turn already drains through memory_extract_pending.
    if (input.scheduledExtractionTurn)
        return { drain: false, reason: "scheduled-turn" };
    const sessionKey = typeof input.sessionKey === "string" ? input.sessionKey.trim() : "";
    if (sessionKey.length === 0)
        return { drain: false, reason: "no-session" };
    if (!(input.queuedTurns > 0))
        return { drain: false, reason: "nothing-queued" };
    if (input.drainInFlight)
        return { drain: false, reason: "already-in-flight" };
    if (input.rateLimited)
        return { drain: false, reason: "rate-limited" };
    const minIntervalMs = input.minIntervalMs ?? DEFAULT_TURN_START_DRAIN_MIN_INTERVAL_MS;
    if (minIntervalMs > 0 &&
        typeof input.lastDrainAt === "number" &&
        input.now - input.lastDrainAt < minIntervalMs) {
        return { drain: false, reason: "throttled" };
    }
    return { drain: true, reason: "drain" };
}
function firstNonEmptyString(...values) {
    for (const value of values) {
        if (typeof value === "string" && value.trim().length > 0)
            return value.trim();
    }
    return "";
}
/**
 * Resolve the conversation session key for a hook turn. Mirrors the resolution
 * used by the capture hooks (ctx first, then event) and falls back to the
 * sessionId through the plugin's sessionId -> sessionKey alias when only an id
 * is available.
 */
export function resolveTurnSessionKey(event, ctx, aliasLookup) {
    const e = (event ?? {});
    const c = (ctx ?? {});
    const direct = firstNonEmptyString(c.sessionKey, e.sessionKey);
    if (direct)
        return direct;
    const sessionId = firstNonEmptyString(c.sessionId, e.sessionId);
    if (!sessionId)
        return "";
    const alias = aliasLookup ? aliasLookup(sessionId) : undefined;
    return typeof alias === "string" && alias.trim().length > 0 ? alias : sessionId;
}
