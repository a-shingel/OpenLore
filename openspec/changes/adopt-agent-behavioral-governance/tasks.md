# Tasks — Adopt the agent behavioral governance layer (staged)

> Rebase PR #83 onto current `main`. Land the core green; defer the heavy machinery. Call
> `record_decision` before the `panicResponse.mode` config contract and the
> `updatePanic()`/`updateTracker()` split (both architectural), per `CLAUDE.md`.

## 1. Integration onto current main (this PR — get to green)
- [ ] Port net-new files: `panic-response.ts`, `panic-constants.ts`, `panic-check.ts`, `panic-level.ts`
      and their tests.
- [ ] Add behavioral fields to `EpistemicTracker`; extract `updatePanic()` from `updateTracker()` and
      export it. `updateTracker()` (V4 freshness, `repoMovedSinceOrient`) stays unchanged and always runs.
- [ ] Resolve `mcp.ts`: panic injection rides the **current** response path (`rawText` → `capOutput`),
      and `panic_level`/`panic_score` are added to main's richer `tool_call` emit (not a duplicate emit).
- [ ] Resolve `telemetry.ts`: combine `redactSecrets()` (main, security) **with** rotation (PR). Redaction
      must remain on every write.
- [ ] Resolve `setup.ts`: fix the `installClaudeHook` import (main removed it); reconcile the `--global`
      option (main) with `--panic` (PR). Do **not** auto-install hooks.
- [ ] Resolve `index.ts` (union command registration), `config-manager.ts`, `types/index.ts`.
- [ ] `panicResponse.mode` added to `OpenLoreConfig`; ladder = `off | observe | advisory`; default `off`.
- [ ] Test: `tsc` clean; full suite green; panic test files pass against current main.

## 2. Safe defaults (this PR)
- [ ] `mode: 'off'` default → zero panic overhead (no scoring, no state file, no injection, no telemetry).
- [ ] `panic-check` and `panic-level` always exit 0 (fail-open) on every code path.
- [ ] No hook auto-installed by `setup`; user opts in manually.
- [ ] `updateTracker()` runs in all modes; only `updatePanic()` + `writePanicState()` are gated on mode.

## 3. Telemetry panic section (this PR)
- [ ] `panic.jsonl` domain events with provenance (`panic_score_delta`, `panic_level_change`).
- [ ] `openlore telemetry` panic summary (episodes, recovery latency, trigger frequency).

## 4. Decisions + spec sync (this PR)
- [ ] `record_decision`: adopt behavioral governance as an extension of the EpistemicLease nudge surface;
      core lands behind `mode:'off'`, intervention + Gryph + hooks deferred.
- [ ] `record_decision`: `panicResponse.mode` config contract; `updatePanic()`/`updateTracker()` split.
- [ ] Confirm no new tool enters the default/minimal MCP surface.

## 5. Deferred — follow-up PRs (NOT this PR)
- [ ] **Validate accuracy** on `observe`-mode telemetry: false-positive rate on real sessions. Gate all
      intervention on this.
- [ ] **`experimental_blocking`** mode — only after accuracy is shown.
- [ ] **Gryph** (`gryph-bridge.ts`, `gryph-watch.ts`, daemon, PID file, CAS, external binary) — evaluated
      on its own merits as a separate change.
- [ ] **Auto-installed hooks** via `setup --hooks` — after the core is validated.
- [ ] **observe → memory feedback loop** — turn behavioral observability into a durable memory/orient
      signal (the north-star payoff). Its own change proposal.
