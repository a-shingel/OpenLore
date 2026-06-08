# Tasks: add structural landmark signals

## 1. Labeled-signal pass (no composite score)
- [ ] Add `src/core/analyzer/landmark-signals.ts` exporting
      `computeLandmarkSignals(graph: SerializedCallGraph): Landmark[]`, where
      `Landmark = { id, name, filePath, signals: LandmarkSignal[] }` and
      `LandmarkSignal = { label: 'hub'|'orchestrator'|'chokepoint'|'volatile'|'entrypoint'|'dead', evidence }`.
      There is **no** `score` field and **no** weighting — a function appears iff it earns ≥1 label.
- [ ] Derive each label from the EXISTING classifier; do not recompute or introduce a threshold:
      - `hub`: the hub set feeding `handleGetCriticalHubs` (`graph.ts:661`); evidence `{ fanIn }`
      - `orchestrator`: the god-function classifier from `handleGetGodFunctions` (`graph.ts:733`);
        evidence `{ fanOut }`
      - `chokepoint`: the **parameter-free conjunction** `hub ∧ ¬orchestrator` (high fan-in but not
        also high fan-out → a funnel many paths cross). No new numeric cutoff.
      - `volatile`: change-coupling / churn from `change-coupling.ts`; evidence `{ commits, coChangedWith }`
      - `entrypoint`: `SerializedCallGraph.entryPoints`
      - `dead`: dead-code reachability (`reachability.ts:120`)
      → verify: unit test asserts a known hub carries the `hub` label with its real `fanIn`, a
      high-churn function carries `volatile`, and **no `score` field is present on any entry**.

## 2. Surface in orient (task-scoped, proximity-ordered)
- [ ] In `handleOrient` (`orient.ts:156-489`), after the existing function/file matching, take the
      labeled landmarks nearest the matched functions (reuse `weightedBfs` from
      `add-call-distance-scoping` if landed, else hop-distance) and attach the top few as
      `landmarks[]`, **ordered by structural proximity only** — no blended ranking.
- [ ] Gate it behind the existing `lean` flag (same place the other enrichment lives,
      `orient.ts:319-489`) so `lean=true` skips it.
      → verify: `orient.test.ts` shows `landmarks[]` present in full mode, absent in lean mode, each
      entry carrying its `signals[]` with evidence and ordered by proximity to the matches.

## 3. Optional global tool (opt-in preset only)
- [ ] Add `handleGetLandmarks(directory, { limit, label? })` returning the whole-repo labeled
      landmarks, optionally filtered to a single `label`. Register in `TOOL_DEFINITIONS`
      (`mcp.ts:138+`) and the dispatch chain (`tool-dispatch.ts:99-286`), following the `get_cluster`
      wiring (`mcp.ts:1232`, `tool-dispatch.ts:262`) as the template.
- [ ] Add `get_landmarks` to the **`navigation` preset only** (`TOOL_PRESETS`, `mcp.ts:1430`); it
      MUST NOT enter `MINIMAL_TOOLS`. It is opt-in, per the `mcp-quality` tool-surface requirement.
- [ ] Classify the new tool `conclusion` in the contract table from
      `enforce-conclusion-over-graph-tool-contract`.
      → verify: `tool-contract.test.ts` passes for `get_landmarks`; a preset test asserts it is in
      `navigation` and absent from `minimal`.

## 4. Spec + close the loop
- [ ] Land the `specs/analyzer/spec.md` delta in this change.
- [ ] Run `vitest run src/core/analyzer/landmark-signals.test.ts src/core/services/mcp-handlers/orient.test.ts`.
- [ ] `record_decision` titled "Structural landmark signals as labels, not a composite score"
      listing the label→classifier mapping and recording the explicit rejection of a blended/weighted
      salience score.
