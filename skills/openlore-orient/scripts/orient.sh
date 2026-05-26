#!/usr/bin/env sh
# Wrapper: pass the user task to `openlore orient --json`.
# Exits non-zero with stderr message if openlore is not on PATH AND npx fails.
#
# TODO(spec-02-followup): the `openlore orient` CLI subcommand does not yet
# exist on the npm package — orient is currently exposed only as an MCP tool.
# This wrapper is forward-compatible: it will start working the moment the
# CLI subcommand ships. For now, prefer the MCP path documented in SKILL.md.
set -eu
TASK="${1:-}"
if [ -z "$TASK" ]; then
  echo "usage: orient.sh \"<task description>\"" >&2
  exit 2
fi
exec npx --yes openlore orient --json --task "$TASK"
