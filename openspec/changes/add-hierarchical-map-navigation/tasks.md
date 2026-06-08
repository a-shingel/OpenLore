# Tasks: add hierarchical map navigation

## 1. Aggregate communities into a super-graph
- [ ] Add `src/core/analyzer/cluster-graph.ts` exporting
      `buildClusterGraph(graph: SerializedCallGraph): ClusterGraph`, where a super-node is
      `{ communityId, label, memberCount, fileCount, topFiles, topLandmark }` and a super-edge is
      `{ fromCommunity, toCommunity, callCount }`.
- [ ] Derive super-nodes from existing `communityId`/`communityLabel` on `FunctionNode`
      (`call-graph.ts:68-101`); the label-propagation pass already populates these
      (`call-graph.ts:2914-2969`). Do **not** re-cluster.
- [ ] Build super-edges by grouping `CallEdge`s whose endpoints are in different communities and
      counting per (fromCommunity, toCommunity). If `add-call-distance-scoping` has landed, also sum
      inverse-distance as an optional coupling weight.
      → verify: unit test on a fixture with two clusters asserts the super-edge count equals the
      number of cross-cluster calls and self-edges are excluded.
- [ ] Populate `topLandmark` from `add-structural-landmark-salience` if available, else fall back to
      the highest-fan-in member (matching how `get_cluster` already names communities).

## 2. get_map tool — region view
- [ ] Add `handleGetMap(directory, communityId?)` in a new
      `src/core/services/mcp-handlers/map.ts`.
      - No `communityId`: return the whole `ClusterGraph` (super-nodes + super-edges only). Bound the
        super-node count; if a repo has very many communities, return the top-K by size with a
        `truncated` flag and an explicit dropped-count (no silent capping).
      - With `communityId`: delegate to the existing `get_cluster` drill-in
        (`analysis.ts:1031-1097`) so the region-internal view reuses proven code.
- [ ] Register in `TOOL_DEFINITIONS` (`mcp.ts:138+`) and the dispatch chain
      (`tool-dispatch.ts:99-286`), using the `get_cluster` wiring (`mcp.ts:1232`,
      `tool-dispatch.ts:262`) as the template.
      → verify: invoking `get_map` with no args returns only super-nodes/super-edges; with a
      `communityId` returns the same shape as `get_cluster`.

## 3. Contract classification
- [ ] In the contract table from `enforce-conclusion-over-graph-tool-contract`, classify the
      whole-repo `get_map` as `conclusion` (region-granularity navigation answer) and document that
      its drill-in path inherits `get_cluster`'s class.
      → verify: `tool-contract.test.ts` passes for `get_map`.

## 4. Spec + close the loop
- [ ] Land the `specs/mcp-handlers/spec.md` delta in this change.
- [ ] Run `vitest run src/core/analyzer/cluster-graph.test.ts src/core/services/mcp-handlers/map.test.ts`.
- [ ] Update the MCP tool table in `CLAUDE.md` with a "lay of the land / where do regions connect?"
      → `get_map` row.
- [ ] `record_decision` titled "Two-tier hierarchical map navigation over communities" noting the
      region→function granularity and the deliberate non-recursive scope.
