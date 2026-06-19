# Release v2.1.1 (from v2.1.0)

Cross-agent / cross-repo memory release. All changes are **additive and backward-compatible** — no
breaking changes to tools, schemas, or stored data; callers that ignore the new fields/params see prior
behavior.

Shipped on PR #168. Staged by a `chore(release)` bump of `package.json` + `package-lock.json` to
`2.1.1`; the release workflow's tag↔version guard (`.github/workflows/release.yml`) then validates the
`v2.1.1` tag, runs lint/typecheck/tests, publishes to npm with provenance, and updates the Homebrew
formula post-publish. (The runtime version is read from `package.json` at startup — `src/cli/index.ts` —
so the CLI/MCP `--version` and the `tools/list` banner track the bump automatically.)

## What's new

### 1. ReversalAwareness — `add-cross-agent-intent-handoff` (ADR-0017)
`orient` and `recall` gain an additive `reversals` field: for intent in a task's scope that was
superseded or reverted, they surface an explicit **do-not-repeat** warning naming the commit the note was
retired as of and the recorded reason — so a fresh agent does not re-introduce an approach a prior
agent/human already tried and removed. Reads the bitemporal supersession record (memories:
`invalidatedAt`/`invalidatedByCommit`/`supersedes`) and decision `supersedes` links. Deterministic, no
LLM. Bounded with an explicit omission note; reverted intent is **never** re-served as authoritative
current context.

### 2. Fleet-level anchored memory — `FleetLevelAnchoredMemory` (ADR-0019)
The last deferred slice of multi-repo federation. A memory **or decision** recorded in a producer repo
and anchored to an interface it publishes now surfaces, with its producer-side freshness verdict, when an
agent recalls while editing a **consumer** repo that references that interface. `recall` gains opt-in
`federation`/`federationRepos` params and a `fleetMemory` block (`memories` + `decisions`, repos
consulted/skipped, caveats). Orphaned/retired producer records are withheld across the boundary (the
authoritative-recall invariant holds cross-repo). Deterministic, lazy per-repo load, no merged graph.

### 3. Re-read economy benchmark — `add-trust-calibrated-context-economy` item 4 (ADR-0018)
`bench:agent` now captures the agent's tool transcript (`--output-format stream-json`) and reports, per
repo tier, the re-reads avoided, the read-token delta the grounding-certificate lever removes, and the
certificates delivered — so the small/familiar **rent** case is tracked, not hidden. The extractor
(`src/bench/transcript-metrics.ts`) is a pure, CI-tested module; the report degrades to an explicit "no
data" note rather than fabricating when no live transcript exists.

### 4. Two dogfood-surfaced bug fixes
- **`trace_execution_path` boundary honesty:** prefers exact target matches (like `find_path`) instead of
  substring, so it reaches the literal target and the confidence boundary stays honest (`complete:false`
  when a synthesized hop is on the path).
- **Incremental `analyze` fingerprint:** plain `analyze` now re-analyzes on a committed source change
  within the freshness window (gates the skip on the content fingerprint, not a wall-clock TTL); an
  unchanged tree still skips regardless of age.

## Hardening (PR #168 adversarial-QA pass)

### 5. Never-authoritative invariant for superseded decisions — ADR-0020
A decision superseded by another stayed in the authoritative set (orient `pendingDecisions` /
`governingDecisions`, recall authoritative) until LLM consolidation flipped it to `rejected` — which
never runs without an API key — so a superseded-but-`approved` decision was served as current context AND
as a do-not-repeat reversal at once. Fixed with a single shared `supersededDecisionIds()` predicate (a
superseder counts unless itself `rejected`/`phantom`; never self-supersedes) driving BOTH the reversal
warning and the authoritative exclusion on every decision surface, so the two can never disagree.

### 6. Honesty + coverage + doc hygiene
- "(reverted at commit X)" reworded to "(retired as of commit X)" — the SHA is HEAD-when-superseded, not
  a verified reverting diff. Applied across render, spec, ADR-0017, dogfood, tasks, tests.
- Fleet tests gain symbol-level producer-side freshness (`fresh`/`drifted` span-hash branch) and the
  name-match arity-caveat disclosure; the spec notes finalized (`synced`) producer decisions are
  deliberately not federated.
- Bench Bash read-classifier widened (indented/env-prefixed/sudo/multi-line/xargs/do-loop reads) with
  documented residual biases; the dry-run re-read table is marked synthetic.
- Tool-count hygiene: `--preset` help enumerates all 10 navigation tools (with a guard); corrected stale
  "45"/"58" counts and a duplicated, self-contradictory agent-setup paragraph; the analyze fingerprint
  comment now says "metadata fingerprint (path+mtime+size)".
- Proposal statuses reconciled to match shipped code (cross-agent-intent-handoff, code-anchored-memory-
  staleness, multi-repo-federation group 4).

## Verification

- **Tests:** full `vitest run src examples`: **201 files, 4128 passed / 2 skipped / 0 failed.**
  `typecheck` + `eslint` clean.
- **Real-input dogfood + regression sweep:** exercised via the real built CLI and the real MCP server over
  stdio JSON-RPC on fresh `git init` repos — full memory lifecycle (`fresh`→`drifted`→`orphaned`, orphans
  never authoritative), decision supersession reversals projection, incremental re-analysis on a committed
  change, the 60-tool/preset surface, and the bench dry-run. A dedicated regression pass over the QA
  diff confirmed **no existing behavior broke** (non-superseded decisions still surface in
  `pendingDecisions`/`governingDecisions`; the bench regex lost no true-positives). **0 functional bugs.**

## Decisions recorded + synced

- `6c32e6c6` (ADR-0020) — exclude superseded decisions from authoritative recall via one shared
  supersession predicate.
- ADR-0017 (ReversalAwareness), ADR-0018 (re-read economy measurement), ADR-0019 (FleetLevelAnchoredMemory)
  recorded earlier in the PR.

## Notable non-goals / deferred (documented in the proposals)

`add-lean-default-tool-surface` (the lean default MCP preset) remains gated pending second-contributor
review — the only proposal in the backlog not yet built. Embedding-backed recall stays deferred.
