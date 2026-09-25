#!/usr/bin/env bash
set -euo pipefail

# Non-destructive smoke test for a real OpenClaw environment where the plugin is installed.
# Intended for release preflight and on-host validation.

openclaw memory-cip version
openclaw memory-cip stats
openclaw memory-cip list --limit 3
openclaw memory-cip search "plugin" --limit 3

# export/import (dry-run)
TMP_JSON="/tmp/memory-cip-export.json"
openclaw memory-cip export --scope global --category decision --output "$TMP_JSON"
openclaw memory-cip import --dry-run "$TMP_JSON"

# delete commands (dry-run/help only)
openclaw memory-cip delete --help >/dev/null
openclaw memory-cip delete-bulk --scope global --before 1900-01-01 --dry-run

# migrate (read-only)
openclaw memory-cip migrate check

# reembed (dry-run). Adjust source-db path if needed.
if [[ -d "$HOME/.openclaw/memory/lancedb-cip" ]]; then
  openclaw memory-cip reembed --source-db "$HOME/.openclaw/memory/lancedb-cip" --limit 1 --dry-run
else
  echo "NOTE: $HOME/.openclaw/memory/lancedb-cip not found; skipping reembed smoke."
fi

echo "OK: openclaw smoke suite passed"
