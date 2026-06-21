# Dogfood — working-set context briefing (change: add-working-set-context-briefing)

> Run: 2026-06-21, on branch `feat/working-set-context-briefing`. Real-index end-to-end against the
> OpenLore repo itself registered as a spec-store target. Confirms `orient`, generalized from one repo
> to a change's targets, produces a budgeted, per-target-attributed briefing with live callers and
> anchored intent.

## Setup

A temp **home** with a `specStore` binding, a temp **store** holding this change's proposal, and the
real OpenLore repo registered as the federation target `openlore` (it carries a live `.openlore`
index, so binding health classifies it `indexed`):

```
home/.openlore/config.json   → specStore { name: "plans", path: <store>, targets: ["openlore"] }
store/openspec/changes/add-working-set-context-briefing/proposal.md   (+ specs/{cli,mcp-handlers})
federation: openlore → <OpenLore repo>   (openlore federation add <repo> --name openlore)
```

## Binding is sound (precondition)

```
$ openlore spec-store status
Binding "plans" is sound: 1/1 target(s) indexed and consultable.
  store: plans → /tmp/ws-dogfood/plans
  targets: 1/1 indexed
```

## The briefing (human surface)

```
$ openlore working-set context --change add-working-set-context-briefing
Working set for change "add-working-set-context-briefing" on store "plans": 5 item(s) across 1/1 target(s).
  store: plans → /tmp/ws-dogfood/plans
  declared scope: cli, mcp-handlers
  ✓ openlore: 0 spec domain(s), 2 anchored intent

  briefing (5 item(s), ranked):
    [openlore] handleWorkingSetContext  (src/core/services/mcp-handlers/working-set.ts) ← runWorkingSetContextCli, dispatchTool
    [openlore] readChange  (src/core/services/mcp-handlers/working-set.ts) ← handleWorkingSetContext, handleWorkingSetContext
    [openlore] SpecStoreConfig  (src/types/index.ts)
    [openlore] C  (docs/specs/openlore-spec-21-structural-change-analysis.md)
    [openlore] patchRiskContext  (src/core/services/mcp-handlers/change.ts) ← handleAnnotateStory
```

The intent was extracted from the change's `proposal.md` (title + the `## Why` paragraph) and used to
orient the target. The briefing correctly surfaced the change's own implementation surface
(`handleWorkingSetContext`, `readChange`, `SpecStoreConfig`) — each **attributed to the target** and
carrying its **live callers** — plus two **anchored-intent** items (the consolidated decisions anchored
to the in-scope files). `declared scope: cli, mcp-handlers` is read from the change's `specs/` deltas.

## Budget is the single truncation point (JSON surface)

Full budget keeps all five items and surfaces the anchored intent with verdicts:

```
$ openlore working-set context --change … --json
items: 5   anchoredIntent: [(39c187ff, current), (5a27d292, current)]   omissionNote: None
```

A tight `--token-budget 200` truncates the merged briefing and emits the omission note, **without**
starving the anchored intent (orient runs per target at full fidelity; only the merged item list is
budgeted):

```
$ openlore working-set context --change … --token-budget 200 --json
items: 1
omissionNote: "4 more result(s) omitted to fit tokenBudget — raise --token-budget or narrow the change"
anchoredIntent: [(39c187ff, current), (5a27d292, current)]
```

> **Design fix found by this dogfood.** The first cut split the budget per target and passed each slice
> into `handleOrient`. That hid omissions (orient pre-trimmed, so the global pass dropped nothing) and
> **starved the anchored intent** (governing decisions derive from the kept files). Fixed: orient each
> target at full fidelity and make the global `rankAndBudget` the single truncation point. Re-verified
> above — omission note fires and anchored intent survives a tiny budget.

## Partial briefing on an unsound binding (real)

Declaring a second target that the federation registry does not resolve (the registry dedupes by path,
so two names on one path collapse to one) demonstrates the partial-briefing path against a real index:

```
$ openlore working-set context --change … --json   # targets: ["openlore", "openlore-mirror"]
summary: … 5 item(s) across 1/2 target(s).
targets briefed: [("openlore", false), ("openlore-mirror", true)]
findings: binding-unsound (warn), target-not-briefable (warn)
```

The handler briefs whatever targets ARE briefable and reports the rest as findings — it never throws and
never blocks.

## Adversarial round (hostile inputs, real CLI)

A second pass drove deliberately hostile inputs through the real CLI against a live index, and probed
the pure helpers. It found and fixed **one critical security bug** plus two correctness bugs:

- **CRITICAL — change-id path traversal (fixed).** `change = "../../../secret"` escaped the store
  (`<store>/openspec/changes/<id>` → `<scratch>/secret`) and read an **out-of-store** `proposal.md`,
  leaking its contents into `report.change.intent`. Fixed by confining `changeId` with `safeJoin`
  (symlink-aware) inside `readChange`; an escape degrades to `change-not-found` (the no-throw contract
  holds). Verified after the fix:
  ```
  $ openlore working-set context --change "../../../secret" --json
  codes: ['change-not-found']   intent: ''   LEAK? False        # control "real-change": ready=True, 5 items
  $ openlore working-set context --change "/etc" --json
  codes: ['change-not-found']   leak: False                     # absolute paths rejected too
  ```
- **CRLF body loss (fixed).** A Windows-authored proposal (`\r\n`) lost its entire `## Why` body — the
  target got oriented on the bare title. `extractIntent` now normalizes line endings first.
- **Empty-section heading leak (fixed).** An empty `## Why` spilled the next heading (`## What changes`)
  into the orientation query. `extractIntent` now skips `#`-led paragraphs.
- **Lone-surrogate truncation (hardened).** The 950-char slice could leave a dangling high surrogate on
  an emoji-dense proposal; now trimmed. (Length was already ≤ MAX_QUERY_LENGTH, so orient never rejected.)

Other hostile inputs already degraded cleanly and were re-confirmed: `--token-budget abc` (NaN) →
default 8000; change ids with spaces / nonexistent → `change-not-found`; every attack still **exits 0**.
Each fix is now pinned by a test in `working-set.test.ts` (traversal-leak, CRLF, heading-leak,
surrogate) — the suite had no coverage for these before.

## Round 2 — spec-compliance audit + deeper hostile e2e

A spec-compliance pass (every SHALL/Scenario in the canonical specs cross-checked against the code) found
the feature fully wired (handler → dispatch → MCP inputSchema → CLI), with **one behavioral-compliance
defect** plus new edge cases — all fixed and re-verified:

- **Anchored-intent freshness was inverted (fixed).** The spec says "orphaned intent SHALL be withheld;
  drifted intent SHALL be flagged." The handler had mapped orient's `staleDecisions` → `verdict:'drifted'`,
  but orient's `staleDecisions` contains ONLY *orphaned* anchors (`orient.ts:477`), and genuinely *drifted*
  decisions stay in `pendingDecisions` (`verify:true`/`freshness:'drifted'`). So orphaned intent was being
  surfaced (mislabeled "drifted") and truly-drifted intent never appeared. Fixed: anchored intent now
  derives from `orient.pendingDecisions` (per-decision freshness, orphaned excluded by construction) — the
  briefing flags drifted and withholds orphaned, matching the spec. The docs already described the correct
  behavior; only the code was wrong. Decision `7ef4710f`. Verified against the real index:
  ```
  $ openlore working-set context --change real-change --json     # OpenLore repo as target
  anchoredIntent: [(5a27d292,current,"Adopt agent behavioral governa…"),
                   (39c187ff,current,"Keep panic policy in config…"),
                   (b65df761,current,"Confine working-set change ID…")]   # real in-scope decisions, verdicts
  ```
- **Symlink-escape change id (already blocked, now pinned).** A change dir symlinked OUT of the store
  (`<store>/openspec/changes/evil-link → <scratch>/secret`) returns `change-not-found` and leaks nothing —
  `safeJoin` canonicalizes symlinks. Confirmed: `codes: ['change-not-found'] LEAK? False`.
- **Missing store path + valid change → graceful.** `binding-unsound` + `change-not-found`, `ready:false`.
- **Vector index deleted while federation still says `indexed` → `orient-unavailable`.** A target whose
  fingerprint matches the registry but whose `.openlore/analysis` vector index is gone degrades to
  `orient-unavailable` + `no-briefable-targets`, `briefed:false`, never throwing.
- **MCP dispatch path drives `change` + `tokenBudget`.** Via `dispatchTool('working_set_context', …)`:
  full briefing = 5 items; `tokenBudget:200` = 1 item + `omissionNote`; the change id reaches the handler.
  An MCP client can fully drive the tool, not just the CLI.

## Verdict

✅ End-to-end working against a real index, spec-compliant, and hardened against hostile change ids and
proposals. The
briefing is deterministic, conclusion-shaped, per-target-attributed, token-budgeted with an honest
omission note, and folds in fresh anchored intent (orphaned withheld, drifted flagged). No LLM enters the
path — the north star (`c6d1ad07`) holds.

> Multi-target merge across **distinct** indexed repos is covered deterministically by the pure-helper
> unit tests (`briefTargetFromOrient` + `rankAndBudget` over two synthetic targets); registering two
> real distinct indexes is not reproducible in a single-repo dogfood (the federation registry keys by
> path).
