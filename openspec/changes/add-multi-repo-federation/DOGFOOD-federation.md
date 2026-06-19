# Dogfood — multi-repo federation (2026-06-19)

End-to-end validation of the federation subset on two real repos analyzed by the freshly-built CLI.
This is the live evidence behind the IMPLEMENTED status; the deterministic unit coverage is in
`src/core/federation/{registry,resolver}.test.ts` (18 tests) and `mcp-presets.test.ts`.

## Setup

Two tiny repos, each with its own independently-built `.openlore` index:

- **repo-a (producer)** — `src/index.ts` exports `greet(name)` and `farewell(name)`.
  - `greet` → `stable_id: "sid:greet(name: string)"` (internal node).
- **repo-b (consumer)** — `src/app.ts` `welcome()` calls `greet` (imported from `repo-a`),
  `runApp()` calls `welcome()`; `src/app.test.ts` `testWelcome()` exercises `welcome()`.
  - The cross-package call is retained as an external node `{name:"greet", is_external:1}` plus an
    edge `welcome → greet (confidence:"external")`. This is the signal federation resolves on.

```
$ openlore federation add /tmp/fed-exp/repoB --name consumer-b   # run from repo-a
✓ Registered "consumer-b" → /tmp/fed-exp/repoB
$ openlore federation list
  consumer-b           ✓ indexed
```

`.openlore/federation.json` holds `{ name, path, fingerprint, schemaVersion, lastBuilt }`. Force-
reanalyzing repo-b changed its fingerprint and `federation list` / queries correctly flipped it to
`⚠ stale` until re-registered — staleness detection works.

## Per-tool results (via the real `dispatchTool` path)

**federation_status** (home = repo-a): `registered: 1, indexed: 1`, repo state + live-vs-registered
fingerprint reported. Opt-in: this tool exists only under `--preset federation`.

**analyze_impact `greet` + federation** — the headline scenario:
```json
"federation": {
  "consumers": [ { "repo": "consumer-b", "caller": "welcome", "file": "src/app.ts", "symbol": "greet" } ],
  "consumerCount": 1,
  "reposConsulted": ["consumer-b"],
  "reposSkipped": [],
  "caveats": ["Cross-repo consumers are matched by exact symbol name at external call sites; …collision is possible."]
}
```

**find_dead_code + federation** — `farewell` (no consumer anywhere) stays a high-confidence
candidate; `greet` is pulled OUT of candidate-dead and reported as `liveViaFederation` because
consumer-b's `welcome` calls it. Exactly the "is this export dead across all consumers, not just
here?" scenario.

**select_tests `greet` + federation** — selects the consumer's test across the repo boundary:
```json
"federation": { "crossRepoTests": [ { "repo": "consumer-b", "test": "testWelcome", "file": "src/app.test.ts", "viaSymbol": "greet", "confidence": "high" } ], "crossRepoTestCount": 1 }
```
(Test nodes live only in `ctx.callGraph`, not the SQLite store which persists production nodes —
the federated test walk uses the call graph, matching the single-repo `select_tests`.)

**find_path `runApp` → `greet` + federation** (home = repo-b, repo-a registered) — `greet` isn't in
repo-b's graph, so instead of a bare error it returns the cross-repo location + bridge:
```json
"crossRepo": true,
"federation": {
  "producers": [ { "repo": "producer-a", "file": "src/index.ts", "stableId": "sid:greet(name: string)" } ],
  "bridge": { "present": true, "fromHomeCallers": ["welcome"] }
}
```

## Honesty / invariants observed

- No merged graph: each repo's index is loaded lazily via `readCachedContext`; only the repos needed
  are touched. Adding a repo never triggered a global rebuild.
- Every conclusion names `reposConsulted` / `reposSkipped` with a reason (stale/unindexed/missing).
- The cross-repo match is exact on the stable-ID name descriptor; call-site signatures are
  unavailable, so arity is unconfirmed and a bare exported-name collision across packages is possible
  — disclosed in `caveats`, not hidden.

## Bugs found & fixed during dogfooding

1. `findReachingTests` originally walked the SQLite edge store, which holds only production nodes —
   test nodes were invisible and `select_tests` federation returned empty. Rewrote it to traverse
   `ctx.callGraph` (where test nodes live), matching the single-repo handler.
2. `find_path` errored before reaching federation logic when `to` didn't resolve in the home repo.
   Reordered so a `to` published by another repo resolves to a cross-repo location instead of an error.
3. `tools/list` payload budget + the tool-driver coverage gate + tool-contract classification all
   needed the new tool registered — caught by existing guard tests and fixed.

## Adversarial re-dogfood (2026-06-19, session 2)

Re-ran the full scenario set on **freshly `openlore analyze`-built** repos (not hand-shaped indexes),
driving the real `dispatchTool` path, plus a third repo (`repo-c`) that calls a *different* package's
`greet` to probe the disclosed name-collision case. Three real bugs surfaced that the synthetic unit
tests had masked; all are now fixed with regression tests (`registry.test.ts`, `resolver.test.ts`).

1. **Registry path identity was not symlink-canonical** (`registry.ts`). The CLI passes
   `process.cwd()` (OS-canonicalized) as the home dir, but a user-supplied repo path was only
   `resolve()`d. On a system where the working tree sits behind a symlink (macOS `/tmp` →
   `/private/tmp`, a symlinked checkout) the home-repo self-add guard, path de-dup, and remove-by-path
   all silently failed to match the same directory — e.g. `openlore federation add .` from the home
   repo registered the repo as its own peer, and every federated conclusion then consulted the home
   repo as a "consumer." Fixed with a `canonicalize()` (realpath, resolve-fallback) used for all path
   comparisons; the unit test now exercises symlinked spellings. The original happy-path dogfood missed
   this because its paths were already canonical.

2. **Federated `select_tests` ignored `tested_by` edges** (`resolver.ts` `findReachingTests`). The
   single-repo handler discovers tests from two sources — test *nodes* reached by the backward
   call-walk **and** import-based `tested_by` edges — but the federated walker implemented only the
   first. The real analyzer associates a typical test file with the production it covers via a
   `tested_by` edge (an inline `it("…")` block produces no callable test symbol), so on a real consumer
   index `select_tests <symbol> --federation` returned **`crossRepoTests: []`** even though the
   consumer's code was tested. (The original dogfood's `testWelcome` result came from a hand-built
   `testWelcome → welcome` call edge, which the analyzer does not emit for an inline test.) The walker
   now honors `tested_by` on the seeds and on every reached production node; the cross-repo test is
   selected (`app.test`, high confidence) on the real index.

3. **`find_dead_code` silently dropped federation in `ifDeleted` mode** (`reachability.ts`). The
   delete-impact branch returns before the federation block, so `federation: true` was accepted and
   ignored with no disclosure — violating the "every federated conclusion names its coverage" invariant.
   Now the delete-impact response carries a `federationNote` explaining that federation scope is a
   within-repo reachability query here and pointing to the candidate-dead / `analyze_impact` paths for
   cross-repo liveness.

Re-verified after the fixes, end-to-end through `dispatchTool`: home-repo self-add is rejected;
symlinked-spelling re-add refreshes (not appends); `analyze_impact greet --federation` names
`consumer-b` **and** `consumer-c` (collision disclosed in `caveats`, not hidden) and no longer
self-consults the home repo; `find_dead_code --federation` keeps `greet` live-via-federation while
`farewell` stays high-confidence dead; `select_tests greet --federation` selects the consumer test
across the boundary; `find_path runApp→greet --federation` returns the cross-repo producer + bridge.
Full suite green after the fixes.
