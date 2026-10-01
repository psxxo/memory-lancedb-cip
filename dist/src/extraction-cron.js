/**
 * Managed extraction cron.
 *
 * The host authorizes a plugin's LLM completion against the live turn, so a
 * post-turn extraction call is refused ("caller authority is no longer
 * active"). Instead of owning a credential, this lane borrows the host's own
 * scheduler: a managed cron job whose payload is an isolated agentTurn. When
 * that turn runs, the host owns it, so the extraction completion inside it is
 * authorized exactly like any other turn's model call — no plugin credential,
 * no configuration, and no dependency on post-turn authority.
 *
 * The shape mirrors the managed-cron pattern already used by
 * memory-lancedb-dreaming: resolve the host cron service at gateway start,
 * then reconcile one managed job by name/tag.
 */
export const EXTRACTION_TRIGGER_TOKEN = "__openclaw_memory_lancedb_cip_extract_trigger__";
/**
 * Body of the scheduled turn. The host authorizes a model completion against
 * the live turn; a plugin completion fired from a finished turn is refused, so
 * the deferred texts are extracted by the AGENT of this scheduled turn instead.
 * The token stays in the message for cheap detection/short-circuit; the
 * instruction tells the agent to drain the queue through the plugin tool, which
 * persists extracted memories via the plugin's own pipeline.
 */
export const EXTRACTION_TRIGGER_INSTRUCTION = "Scheduled memory extraction. Call the memory_extract_pending tool exactly once. " +
    "It returns the conversation texts queued since the last extraction and persists the " +
    "memories it extracts from them for this agent. Then reply with a single short line: how " +
    "many memories were created/merged, or NO_REPLY when the tool reports nothing queued.";
export const EXTRACTION_TRIGGER_MESSAGE = `${EXTRACTION_TRIGGER_TOKEN}\n\n${EXTRACTION_TRIGGER_INSTRUCTION}`;
export const MANAGED_EXTRACTION_CRON_NAME = "LanceDB Memory Extraction";
export const MANAGED_EXTRACTION_CRON_TAG = "[managed-by=memory-lancedb-cip]";
export const EXTRACTION_CRON_RECONCILE_INTERVAL_MS = 60_000;
export const STARTUP_CRON_RETRY_DELAY_MS = 5_000;
export const STARTUP_CRON_MAX_RETRIES = 120;
export const DEFAULT_EXTRACTION_CRON_EXPR = "*/2 * * * *";
/** Accepts only a candidate exposing the full list/add/update/remove surface. */
export function resolveCronServiceFromCandidate(candidate) {
    if (!candidate || typeof candidate !== "object")
        return null;
    const cron = candidate;
    if (typeof cron.list !== "function" ||
        typeof cron.add !== "function" ||
        typeof cron.update !== "function" ||
        typeof cron.remove !== "function") {
        return null;
    }
    return cron;
}
/** The gateway_start payload carries the host context that owns the cron service. */
export function resolveCronFromGatewayStartupEvent(event) {
    const payload = event;
    const context = payload?.context;
    if (!context)
        return null;
    return (resolveCronServiceFromCandidate(context.cron) ??
        resolveCronServiceFromCandidate(context.deps?.cron));
}
export function buildManagedExtractionCronJob(cronExpr, timezone) {
    return {
        name: MANAGED_EXTRACTION_CRON_NAME,
        description: `${MANAGED_EXTRACTION_CRON_TAG} flush deferred memory extraction inside an isolated agent turn (cron=${cronExpr}).`,
        enabled: true,
        schedule: {
            kind: "cron",
            expr: cronExpr,
            ...(timezone ? { tz: timezone } : {}),
        },
        sessionTarget: "isolated",
        wakeMode: "now",
        payload: { kind: "agentTurn", message: EXTRACTION_TRIGGER_MESSAGE },
        delivery: { mode: "none" },
    };
}
export function isManagedExtractionJob(job) {
    const description = typeof job.description === "string" ? job.description : "";
    if (description.includes(MANAGED_EXTRACTION_CRON_TAG))
        return true;
    const name = typeof job.name === "string" ? job.name : "";
    const payloadText = job.payload?.message ?? job.payload?.text;
    return name === MANAGED_EXTRACTION_CRON_NAME && payloadText === EXTRACTION_TRIGGER_TOKEN;
}
export function includesExtractionTriggerToken(body) {
    return typeof body === "string" && body.includes(EXTRACTION_TRIGGER_TOKEN);
}
export async function reconcileManagedExtractionCron(params) {
    const { cron, logger } = params;
    if (!cron)
        return { status: "unavailable", removed: 0 };
    let jobs;
    try {
        jobs = await cron.list({ includeDisabled: true });
    }
    catch (err) {
        logger.warn(`memory-lancedb-cip: extraction cron list failed: ${String(err)}`);
        return { status: "unavailable", removed: 0 };
    }
    const managed = jobs.filter(isManagedExtractionJob);
    if (!params.enabled) {
        let removed = 0;
        for (const job of managed) {
            try {
                if (job.id && (await cron.remove(job.id)).removed === true)
                    removed += 1;
            }
            catch (err) {
                logger.warn(`memory-lancedb-cip: extraction cron remove failed: ${String(err)}`);
            }
        }
        return { status: "disabled", removed };
    }
    const desired = buildManagedExtractionCronJob(params.cronExpr, params.timezone);
    if (managed.length === 0) {
        try {
            await cron.add(desired);
            logger.info("memory-lancedb-cip: managed extraction cron job created");
            return { status: "added", removed: 0 };
        }
        catch (err) {
            logger.error(`memory-lancedb-cip: managed extraction cron job create failed: ${String(err)}`);
            return { status: "unavailable", removed: 0 };
        }
    }
    const [primary, ...duplicates] = managed;
    let removed = 0;
    for (const duplicate of duplicates) {
        try {
            if (duplicate.id && (await cron.remove(duplicate.id)).removed === true)
                removed += 1;
        }
        catch (err) {
            logger.warn(`memory-lancedb-cip: extraction cron duplicate removal failed: ${String(err)}`);
        }
    }
    if (!primary.id)
        return { status: "unchanged", removed };
    try {
        await cron.update(primary.id, desired);
        return { status: "updated", removed };
    }
    catch (err) {
        logger.warn(`memory-lancedb-cip: extraction cron update failed: ${String(err)}`);
        return { status: "unchanged", removed };
    }
}
/** Resolves the configured schedule, falling back to the shipped default. */
export function resolveExtractionCronExpr(configured) {
    return typeof configured === "string" && configured.trim() ? configured.trim() : DEFAULT_EXTRACTION_CRON_EXPR;
}
