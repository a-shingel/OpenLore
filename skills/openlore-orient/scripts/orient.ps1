# Wrapper: pass the user task to `openlore orient --json` on Windows.
# Exits non-zero with stderr message if openlore is not on PATH AND npx fails.
#
# TODO(spec-02-followup): the `openlore orient` CLI subcommand does not yet
# exist on the npm package — orient is currently exposed only as an MCP tool.
# This wrapper is forward-compatible: it will start working the moment the
# CLI subcommand ships. For now, prefer the MCP path documented in SKILL.md.

param(
  [Parameter(Mandatory=$false, Position=0)]
  [string]$Task
)

$ErrorActionPreference = 'Stop'

if ([string]::IsNullOrWhiteSpace($Task)) {
  [Console]::Error.WriteLine('usage: orient.ps1 "<task description>"')
  exit 2
}

& npx --yes openlore orient --json --task $Task
exit $LASTEXITCODE
