# Release runbook — memory-lancedb-cip

Goal: releases should be boring. Work the phases in order; each phase has an explicit
**do-not-proceed-until**. Distilled from the 1.6.3 release, where the failures were all
*process* failures, not code failures.

## The three non-negotiables

1. **Single-flight.** Exactly one push / publish attempt in flight at a time. Never start a
   second while the first is unresolved. Concurrent retries are what left hung
   \`git\`/\`clawhub\` processes behind.
2. **Capture output to a file, then read it.** Never pipe a push/publish through \`tail\` — a
   hung or even *successful* command can look like "no output at all".
3. **After "Update submitted", wait.** The registry keeps showing the previous version for
   ~10 minutes while security scans run. That is normal. Never re-publish blindly.

## Phase 0 — Pre-flight cleanup (always do this FIRST)

Leftovers are what turn one failure into a cascade.

\`\`\`sh
ps -eo pid,etimes,args | grep -E '[g]it push|[g]it-remote-https|[c]lawhub'   # must be empty
ls .git/index.lock 2>/dev/null                                              # must not exist
git status --porcelain                                                       # empty (or intended)
timeout 10 curl -sS -o /dev/null -w '%{http_code}\n' https://github.com     # 200
timeout 10 curl -sS -o /dev/null -w '%{http_code}\n' https://clawhub.ai     # 200
\`\`\`

**Do not proceed until** there are no hung release processes, no lock, and both endpoints
return 200. If connectivity is down, stop and retry later — do not start the release.

## Phase 1 — Version + docs (no network)

- Pick the version with the decision model (docs-only → patch; behaviour → minor).
- \`package.json\` \`version\` ← new; then \`node scripts/sync-plugin-version.mjs openclaw.plugin.json package.json\`.
- \`CHANGELOG.md\` starts with \`## <version>\`; \`docs/FEATURES.md\` version line updated.
- **Three points in one line**: manifest \`configSchema\` ↔ \`docs/FEATURES.md\` ↔ all 11 \`README*.md\`.
- \`docs/notes/extraction-realtime-lane-A.md\` updated if behaviour changed.

## Phase 2 — Verify (local, no network)

- versions match (\`package.json\` == \`openclaw.plugin.json\`) and CHANGELOG head == version.
- \`npm pack --dry-run\` includes compiled \`dist/\` — **run it once, in background, with a timeout**;
  it has hung before. Never loop it.
- Behaviour release only: full build + guards (\`npm run test:packaging-and-workflow\`, \`npm run build\`).
- Doc checks in \`docs/release-checklist.md\`.

## Phase 3 — Commit + push (network, SINGLE-FLIGHT)

\`\`\`sh
timeout 90 git push origin master 2>&1 | tee /tmp/rel-push.txt   # capture, never tail-only
git rev-list --count @{u}..HEAD                                  # done when 0
\`\`\`

- ONE attempt at a time. If it times out: kill the exact PIDs
  (\`ps -eo pid,args | grep '[g]it-remote-https'\` → TERM → verify none remain), re-check
  connectivity, wait, then retry **once**.

## Phase 4 — Publish (network, SINGLE-FLIGHT)

\`\`\`sh
timeout 240 clawhub package publish . --source-repo psxxo/memory-lancedb-cip --source-commit "$(git rev-parse HEAD)" > /tmp/rel-pub.txt 2>&1
cat /tmp/rel-pub.txt
\`\`\`

- ONE attempt at a time; output to a file, not a pipe.
- **Success = the file contains** \`Update submitted for @psxxo/lancedb-cip@<version>; pending security scans\`.
- If that line is absent: kill the hung process, then retry **once**. Do not fire several at once.

## Phase 5 — WAIT for the scan (be patient here)

- After a successful submit the registry **still shows the previous version for ~10 minutes**.
  This is the security scan, not a failure.
- \`clawhub package inspect @psxxo/lancedb-cip\` may print nothing or a cooldown
  (\`reset in 48s\`); that is not evidence of failure either.
- Poll at most every ~2–5 min. Do **not** re-publish inside this window.
- **Done when** \`Tags: latest=<new version>\`.

## Phase 6 — Cleanup (always, before ending)

- Kill leftover release processes by exact PID; verify none remain.
- Remove temp files (\`/tmp/rel-*\`, \`/tmp/az-*\`).
- Verify a single gateway process and that its PID equals \`systemctl --user show -p MainPID --value openclaw-gateway\`.

## Failure playbook (observed in 1.6.3)

| Symptom | Cause | Do |
|---|---|---|
| push/publish hangs, no output | transient egress + piped output hidden | kill hung PID, verify connectivity, retry once |
| several hung \`git\`/\`clawhub\` processes | concurrent retries | never retry concurrently — single-flight |
| registry still shows old version | scans not finished (~10 min) | wait; do not re-publish |
| \`npm pack --dry-run\` hangs | slow/big \`dist\` | run once, background, timeout |
| \`clawhub inspect\` returns nothing | cooldown / API hiccup | re-check in a minute; not proof of failure |
