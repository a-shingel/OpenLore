# Dogfood report — PR 161 features since v2.0.19

Manual end-to-end dogfood of everything PR 161 introduces on top of published `v2.0.19`, exercising
the **real built CLI** and the **real MCP server over stdio JSON-RPC** (not just unit tests), against
freshly `git init`'d demo repos and this repo's analysis graph.

> Result: **0 functional bugs** in the introduced features. 1 pre-existing cosmetic observation
> (out of scope). Full suite green (185 files, 3863 passed / 2 skipped), `typecheck` + `eslint` clean.

## Features covered

1. `improve-recall-retrieval-ranking` — deterministic field-weighted recall ranking.
2. `add-trust-calibrated-context-economy` — grounding certificates, verified-current, budget tiering.
3. `add-agent-onboarding-connect` — `openlore connect` + preset/permission wiring on the install engine.

## Method

- Built `dist` from the branch; `node dist/cli/index.js …` for the CLI.
- For the memory tools, drove `node dist/cli/index.js mcp --no-watch-auto` over stdio with a JSON-RPC
  client (`initialize` → `notifications/initialized` → `tools/call`), i.e. the exact path a coding
  agent uses — exercising the tool **schema + dispatch + handler**, not just the handler function.
- Demo repo: a clean `git init` JS project (`src/math.js` with `add`/`mul`, `src/sum.js` with `total`).

## What was exercised, and the result

### `openlore connect` (real CLI)

| Scenario | Result |
|----------|--------|
| `connect --help` | Correct usage, options, subcommands (`list`, `remove`), examples |
| `connect list` (clean repo) | Non-mutating; statuses correct (claude-code/agents-md detected via `~/.claude` + universal fallback) |
| `connect claude-code` (DEFAULT, builds index) | Full first-run: CLAUDE.md block, `.mcp.json`, SessionStart hook, `Bash(openlore:*)` permission, BM25 index built (3 functions), exit 0 |
| Re-run `connect claude-code` | Fully idempotent — every change `noop` |
| `connect cursor --preset memory` over a pre-existing user `.cursorrules` | User content preserved; one managed block injected; `--preset memory` threaded into `.cursor/mcp.json` |
| `connect --preset bogus` | Exits **2**, writes **nothing** (verified on a clean repo) |
| `connect` (no agent, non-TTY) | Detection fallback wires claude-code + agents-md |
| `connect remove cursor` / `remove` (all) | Strips the managed block, deletes OpenLore-only files; **user content preserved** |
| `connect list` after connect/remove | Reports `connected` even when wired with a non-default preset (presence-based `isConnected`) |

### Recall ranking + trust-calibrated (real MCP server, stdio)

| Scenario | Result |
|----------|--------|
| `remember` anchored to `add` | Symbol resolved against the demo repo's real graph; `anchored: true` |
| `recall("add")` | Anchored memory ranks #1 with `match.anchorBoost: true`; field-weighted ordering |
| Grounding certificate (symbol anchor) | `{symbol:"add", filePath:"src/math.js", lineSpan:{1,3}, contentHash}` — line span matches the real function; `verifiedCurrent: true` |
| Grounding certificate (file-only anchor) | `{filePath:"src/sum.js", contentHash}` — no symbol/lineSpan, `verifiedCurrent: true` |
| Drifted fact (after editing `src/math.js`) | `freshness: "drifted"`, `verify: true`, **no** certificate, **not** verified-current |
| `recall(task, tokenBudget=1)` with 2 matches | Returns 1 (core), `budget {returned:1, withheld:1}`, no-silent-cap note present |
| `recall(task, tokenBudget=1)` with 1 match | `withheld:0`, no note |
| `recall` (no task) | Full staleness scan; summary counts correct |

## Findings

- **No functional bugs** introduced by the three features. Certificates, verified-current gating,
  budget truncation/reporting, ranking order, and the full connect lifecycle all behave per spec
  through the real CLI and the real MCP server.
- **Pre-existing cosmetic (out of scope):** `connect remove` deletes OpenLore's files but leaves
  now-empty config directories (`.claude/`, `.cursor/`, `.cursor/rules/`). This predates PR 161 — the
  uninstall adapters unlink files without pruning empty parents (true of `settings.json` removal before
  this PR). Noted for a future tidy-up; not addressed here to keep the PR surgical.

## Certification

- `vitest run src`: 185 files, 3863 passed / 2 skipped / 0 failed.
- `tsc --noEmit`: clean. `eslint`: clean.
- No source files were modified during the dogfood (it was read-only against throwaway repos); this
  report is the only artifact added.
