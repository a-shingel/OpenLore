---
description: Find and fix bugs that break OpenLore's first-run experience by dogfooding the real install flow on a clean repo (the method that found the orient-CLI, --no-embed, watcher-EMFILE, and install-index bugs).
---

# OpenLore first-run hardening pass

You are working in the OpenLore repo, a published npm CLI (`openlore`) that gives coding
agents persistent architectural memory via static analysis + an MCP server. Your job: find
and fix the bugs that break a NEW USER's first-run experience — the way earlier passes found
"unknown command 'orient'", "--no-embed kills BM25", "watcher EMFILE on target/", and
"install never builds the index".

If the user named a target repo or a specific area in their message ($ARGUMENTS), focus there;
otherwise pick a clean repo as described below.

## Method — dogfood, don't just unit-test

1. BUILD FIRST so you test current code, not the published version:
   `npm run build` → drive `node dist/cli/index.js`, never bare `openlore`/`npx openlore`
   (those resolve the OLD published version). When comparing to published behavior, do it
   explicitly with `npx --yes openlore@latest` and label it.

2. Pick a CLEAN sibling repo under the parent of this repo that does NOT already have openlore
   (check: no `.openlore`, no `openspec/`, no OpenLore block in `CLAUDE.md`). Prefer variety
   across runs — a Rust repo (huge `target/`), a big monorepo, a Python repo, a repo with a
   pre-existing `.claude/settings.json`. proxilion (Rust) and vaulytica (TS) are known-good.

3. Run the REAL first-run flow as a user would, end to end, checking exit codes AND actual
   output of each step:
     openlore install                 # the one-command path
     # then simulate the first agent session: run the SessionStart hook command verbatim
     # from .claude/settings.json, plus a real `orient --task` query
   Also exercise: init → analyze → analyze --no-embed → analyze --force →
   orient (no task / with task / bad --limit) → install --no-analyze → install --dry-run →
   install --uninstall → mcp server over stdio (initialize → tools/call orient).

4. Stress the edges that break in the field, not just happy paths:
   - Large/non-TS repos (build dirs: target/, node_modules/, dist/, .venv/, vendor/) → EMFILE,
     ENOSPC, multi-minute hangs, watching the wrong tree.
   - `--json` output must be PURE parseable JSON on stdout; all diagnostics/logs go to stderr.
     (Pipe `2>/dev/null` and JSON.parse it.)
   - Idempotency / re-runs: running install or analyze twice must be a clean no-op, not a
     duplicate or a clobber.
   - Pre-existing user files (.claude/settings.json, CLAUDE.md, .gitignore): MERGE, never
     clobber. Verify with a repo that already has them.
   - process.cwd() vs explicit-dir handling; commander singletons leaking option state
     between parseAsync calls in tests.
   - Wrapper/skill paths (orient.sh, orient.ps1, orient-via-mcp.mjs) and graceful degradation
     against OLDER openlore versions that lack new flags.

## Rules

- ROOT-CAUSE every bug before fixing. Reproduce with a concrete command and capture real
  output. Distinguish "code bug" from "test pollution" (e.g. commander option-state leaking
  across parseAsync — fix the test) from "environment quirk". Don't theorize when you can run it.
- Prefer ROBUST fixes over patches. (The watcher fix matched ignored dirs by root-relative
  path SEGMENT so the dir itself is pruned — not a bigger substring list that still FD-storms.)
- Match existing code style; surgical changes only; no speculative features.
- Every fix gets a regression test that FAILS before and PASSES after. Where it matters, use a
  real-dependency test (e.g. real chokidar on a real temp tree), not just a mock.
- Treat other people's repos as READ-ONLY fixtures: after each dogfood run, remove ALL openlore
  artifacts (.openlore, openspec/, CLAUDE.md, ARCHITECTURE.md) and `git checkout` any modified
  .gitignore / settings.json. Verify the repo is clean (`git status`) before moving on. Never
  commit to a test repo.
- Verify honestly: run `npm run typecheck` and `npm run test:run` and report the REAL counts.
  Never fabricate a passing count. If something's red, say so with the output.

## Git / PR discipline

- NEVER commit to or push `main`. Work on a feature branch; confirm with
  `git rev-list --left-right --count origin/main...main` (want `0 0`) before and after.
- If the user points you at an open clean-up PR, commit there; otherwise create a feature
  branch + PR against main with `gh pr create`. Use `--force-with-lease` for a stale remote
  branch, and verify `gh pr view <n> --json baseRefName` is `main`.
- Commit messages: accurate, no fabricated test counts; end with the Co-Authored-By trailer.
- Branch pruning: only delete branches already merged into origin/main (verify with
  `git branch -r --merged origin/main`); never touch cross-repo PR branches (forks — check
  `gh pr view <n> --json isCrossRepository`).

## Deliverable

For each issue: a one-line repro, the root cause, the fix (file:line), and the regression
test. End with: full suite result (real numbers), what you verified by dogfooding on which
repo, and the PR link. Call out anything that ships to users only on the next npm publish.
