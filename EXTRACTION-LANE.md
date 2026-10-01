# Extraction lane: why there is a scheduled job, and where it is going

Recorded 2026-10-02, after the owner asked whether the scheduled extraction task is still
needed. Short answer: it **is** load-bearing today, and the plan is to make it mostly
unnecessary.

## The constraint

The plugin cannot call the host model from a finished turn. The host authorises a plugin
completion against the live run: after the turn ends the caller has no authority. Attempts
and outcomes, in order:

- 1.3.3 wrapped host calls in a plugin-built AsyncWorkScope (fixed the closed-scope error
  but not the authority error).
- 1.3.4 added a plugin-owned credential fallback lane - withdrawn, it violates the owner's
  rule that plugins must follow the host model with no per-install credentials.
- 1.3.5 waited up to ~12s inside the agent_end hook - still refused.
- 1.3.6 retried through execution mode isolated-agent-runtime - also refused.
- 1.3.9 stopped calling the model after the turn: a host-scheduled isolated agent turn now
  does the extraction, its own agent calling the memory_extract_pending tool.
- 1.3.10 made the pending queue durable (pending-extraction-queue.jsonl) because the host
  re-captures the plugin generation per run, so the tool ran in a different module instance
  from the one that queued the texts and read an empty in-memory map.

## Current design (2026-10-02, before this change)

A managed cron job, LanceDB Memory Extraction, runs an isolated agent turn on a schedule
(originally every 2 minutes). The turn's agent calls memory_extract_pending, which drains
the durable queue and persists extracted memories.

Measured cost: each run is a full isolated agent turn - tool catalogue, context build,
model call - on a 2 vCPU / 3.7GB host. Evidence that it is load-bearing (after the
2026-10-02 05:26 restart):

- 05:38:22 pending extraction drain start: inMemorySessions=0 durableSessions=2 durableEntries=8 mergedSessions=2
- 05:41:38 scheduled extraction for agent:main:dashboard:...: 2 created, 1 merged, 0 skipped
- 05:42:39 scheduled extraction for agent:main:dashboard:...: 2 created, 0 merged, 2 skipped
- 05:44:38 scheduled extraction for agent:main:dashboard:...: 1 created, 1 merged, 1 skipped

and that the direct lane still fails: 05:38:22 llm-client [extract-candidates] host-transport
request failed for model : Plugin inventory has retired; begin a new plugin operation.

## Planned design

Decision model, 2026-10-02: turn_start_plus_sweep 0.86 (confidence 0.82).

1. **Primary - drain at the start of the next turn.** When a turn begins for a session that
   has queued texts, the plugin drains them then, while a run is active and authority should
   exist. No dedicated turn, no extra load. This has to be proven on the real host: the
   turn-start authority assumption is untested.
2. **Safety net - a low-frequency sweep.** Sessions that never speak again would otherwise
   keep their texts queued forever, so a scheduled sweep is kept at a long interval
   (decision model: daily 0.38, hourly 0.34 - low confidence; start with a few hours and
   tighten only if extraction latency matters).

Expected result: the frequent scheduled turn disappears, extraction happens on the next
turn for active sessions, and idle sessions are caught by the sweep.

## What would falsify this

If a turn-start drain is refused for the same authority reason, the primary lane does not
work and the sweep stays the real mechanism. Measure before claiming success: look for the
drain line at turn start in the log, and for created/merged counts attributed to the
speaking session's own key rather than to a cron session.
