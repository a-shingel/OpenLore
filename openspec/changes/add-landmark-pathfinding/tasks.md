# Tasks: add landmark pathfinding

## 1. Endpoint resolution
- [ ] Add `resolveEndpoint(spec: string, ctx): FunctionNode[]` in a new
      `src/core/services/mcp-handlers/pathfind.ts`. Support:
      - exact / fuzzy name → reuse the case-insensitive substring match already used by
        `trace_execution_path` (`graph.ts:854-941`) and `EdgeStore.searchNodes`.
      - `landmark:<id>` → look up the labeled landmark set from `add-structural-landmark-salience`.
      - `role:entrypoint|hub|sink` — each resolves through an EXISTING classifier, no new threshold:
        `entrypoint` = `SerializedCallGraph.entryPoints`; `hub` = the hub set feeding
        `handleGetCriticalHubs` (`graph.ts:661`); `sink` = **a call-graph leaf that is actually
        called** — zero outgoing internal call edges (existing leaf analysis, `graph.ts:618`) AND
        `fanIn ≥ 1`. This is parameter-free: there is no "high-fan-in" or "leaf-ish" cutoff to tune;
        a function is a sink iff it terminates an internal call chain and has at least one caller.
      - `file:<path>` → all functions whose `filePath` matches.
      → verify: unit test resolves each selector form to a non-empty seed set on the repo fixture,
      and an unresolvable selector returns a clear error (not an empty silent result).

## 2. Cost-based pathfinding
- [ ] Add `findCheapestPath(adjacency, fromSeeds, toSeeds, opts)` that runs the weighted traversal
      from `add-call-distance-scoping` (`weightedBfs`) from the `from` seeds and stops at the nearest
      `to` seed, reconstructing the path via the predecessor map. Fall back to hop-count BFS
      (`graph.ts:97`) if call-distance is not present.
- [ ] Return the single cheapest path plus up to `MAX_ALTERNATES` (propose 3) next-best paths, each
      with `{ chain, hops, distance }`.
      → verify: on a fixture with a short weak path and a longer strong path, the strong path wins
      when call-distance is enabled and the short path wins under pure hop-count.

## 3. find_path tool
- [ ] Add `handleFindPath(directory, from, to, opts)` composing endpoint resolution + cheapest-path.
      Response: `{ from, to, resolvedFrom, resolvedTo, path: {chain,hops,distance}, alternates[],
      reason }`.
- [ ] Register in `TOOL_DEFINITIONS` (`mcp.ts:138+`) and the dispatch chain
      (`tool-dispatch.ts:99-286`) using the `trace_execution_path` entry as the closest template.
- [ ] Add `find_path` to the **`navigation` preset only** (`TOOL_PRESETS`, `mcp.ts:1430`); it MUST
      NOT enter `MINIMAL_TOOLS`. Opt-in, per the `mcp-quality` tool-surface requirement.
- [ ] Classify `find_path` as `conclusion` in the contract table from
      `enforce-conclusion-over-graph-tool-contract`.
      → verify: `tool-contract.test.ts` passes; response has no unbounded multi-path edge dump.

## 4. Graceful degradation + guardrails
- [ ] When neither endpoint resolves to a connected path within `maxDistance`/`maxDepth`, return a
      structured "no path found within budget" answer including how far the search reached — not an
      empty array the agent must interpret.
- [ ] Reuse the existing depth/path caps (`SUBGRAPH_MAX_DEPTH_LIMIT`, maxPaths≤50) so the new tool
      cannot be used to force an unbounded traversal.

## 5. Spec + close the loop
- [ ] Land the `specs/mcp-handlers/spec.md` delta in this change.
- [ ] Run `vitest run src/core/services/mcp-handlers/pathfind.test.ts`.
- [ ] Update the MCP tool table in `CLAUDE.md` with a "find the route from A to B (by name, role, or
      landmark)" → `find_path` row.
- [ ] `record_decision` titled "Goal-conditioned landmark pathfinding" noting the selector grammar
      and the call-distance-then-hop-count fallback.
