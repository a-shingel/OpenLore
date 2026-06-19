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
