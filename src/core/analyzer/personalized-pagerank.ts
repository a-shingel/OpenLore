/**
 * Personalized PageRank (random-walk-with-restart) over the in-memory call graph.
 * Change: add-personalized-pagerank-context-ranking.
 *
 * "Of the functions connected to this task, which are most relevant?" — answered as
 * a QUERY-CONDITIONED retrieval ranking, seeded by the task's matched symbols. It is
 * NOT a global, task-independent salience score (the `add-structural-landmark-salience`
 * decision still governs that; this adds no score to landmark/structural outputs).
 *
 * Why PageRank and not shortest-path distance: distance ranks a candidate by its single
 * cheapest path to the seeds; personalized PageRank ranks by how many ways, and how
 * densely, a candidate is connected to the seed set — a node reachable by many
 * independent paths outranks one reachable by a single long path. For "pull the most
 * task-relevant functions into a fixed token budget," connectivity-weighted relevance is
 * the better objective (the Aider repo-map result).
 *
 * Determinism mirrors the in-tree label-propagation discipline (call-graph.ts): nodes are
 * iterated in a fixed sorted-id order each pass and incoming contributions are summed in a
 * fixed order, so floating-point results are bit-identical across runs. The caller breaks
 * ties on equal relevance by node id.
 *
 * No new tuning constant: the damping factor and convergence tolerance are the SAME values
 * the system's existing file-level PageRank uses (`constants.ts`), and edge costs are used
 * only by the caller's neighbourhood bounding (`weightedBfs`) — the walk itself is uniform
 * over out-neighbours (textbook PPR), so no edge-weight knob is introduced.
 */

import {
  PAGERANK_DAMPING_FACTOR,
  PAGERANK_CONVERGENCE_TOLERANCE,
  PAGERANK_MAX_ITERATIONS,
} from '../../constants.js';

/** An edge list keyed by source node, as produced by `buildWeightedAdjacency`. */
export type WeightedAdjacency = Map<string, Array<{ to: string; cost: number }>>;

/**
 * Compute personalized PageRank over `universe`, restarting to `seeds`.
 *
 * @param adjacency  directed weighted adjacency (source → out-neighbours). Pick the
 *                   direction the ranking should flow: forward (caller→callee) ranks
 *                   downstream relevance, backward ranks upstream, or an undirected merge
 *                   ranks proximity in either direction.
 * @param seeds      the task seed node ids — the restart distribution is uniform over the
 *                   seeds that fall inside `universe`. Required: with no seed inside the
 *                   universe the function returns an empty map (it is never run as a global,
 *                   seedless importance ranking — the caller falls back to its default order).
 * @param universe   the bounded set of node ids to rank over (e.g. the distance-limited
 *                   neighbourhood `weightedBfs` already explored), so cost stays proportional
 *                   to the task neighbourhood rather than the whole repository.
 * @returns a map from node id to its stationary relevance (a probability distribution over
 *          `universe` summing to ~1); empty when no seed lies in the universe.
 */
export function personalizedPageRank(
  adjacency: WeightedAdjacency,
  seeds: Iterable<string>,
  universe: Iterable<string>,
): Map<string, number> {
  // Fixed sorted-id node order — the determinism anchor (mirrors label-propagation).
  const nodes = [...new Set(universe)].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  if (nodes.length === 0) return new Map();
  const inUniverse = new Set(nodes);

  // Restart distribution: uniform over seeds that fall inside the bounded universe.
  const seedNodes = [...new Set(seeds)].filter(id => inUniverse.has(id));
  if (seedNodes.length === 0) return new Map(); // seedless ⇒ not a global ranking; caller falls back
  const restart = new Map<string, number>();
  for (const id of nodes) restart.set(id, 0);
  const seedShare = 1 / seedNodes.length;
  for (const id of seedNodes) restart.set(id, seedShare);

  // Out-neighbours within the universe, de-duplicated (parallel call edges between the same
  // pair are one connection, not independent paths) and id-sorted (deterministic sum order).
  // Reverse adjacency carries the incoming contributions each pass reads.
  const outDegree = new Map<string, number>();
  const incoming = new Map<string, string[]>();
  for (const id of nodes) incoming.set(id, []);
  for (const src of nodes) {
    const seen = new Set<string>();
    for (const { to } of adjacency.get(src) ?? []) {
      if (!inUniverse.has(to) || to === src || seen.has(to)) continue;
      seen.add(to);
      incoming.get(to)!.push(src);
    }
    outDegree.set(src, seen.size);
  }
  for (const list of incoming.values()) list.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const dangling = nodes.filter(id => outDegree.get(id) === 0);

  const d = PAGERANK_DAMPING_FACTOR;
  let rank = new Map(restart); // init at the restart distribution
  let next = new Map<string, number>();

  for (let iter = 0; iter < PAGERANK_MAX_ITERATIONS; iter++) {
    // Mass on dangling nodes has nowhere to flow; restart it (random-walk-with-restart).
    let danglingMass = 0;
    for (const id of dangling) danglingMass += rank.get(id)!;

    let maxDiff = 0;
    for (const id of nodes) {
      let sum = 0;
      for (const src of incoming.get(id)!) sum += rank.get(src)! / outDegree.get(src)!;
      const teleport = (1 - d + d * danglingMass) * restart.get(id)!;
      const value = teleport + d * sum;
      next.set(id, value);
      const diff = Math.abs(value - rank.get(id)!);
      if (diff > maxDiff) maxDiff = diff;
    }

    [rank, next] = [next, rank];
    if (maxDiff < PAGERANK_CONVERGENCE_TOLERANCE) break;
  }

  return rank;
}

/**
 * Merge a forward and backward weighted adjacency into one undirected adjacency, so a
 * nearby caller OR callee counts as "connected". Mirrors the merge `orient` already does
 * for its distance ranker; factored here for reuse by the PageRank ranking mode.
 */
export function mergeUndirected(
  forward: WeightedAdjacency,
  backward: WeightedAdjacency,
): WeightedAdjacency {
  const undirected: WeightedAdjacency = new Map();
  for (const m of [forward, backward]) {
    for (const [k, arr] of m) {
      const cur = undirected.get(k);
      if (cur) cur.push(...arr);
      else undirected.set(k, [...arr]);
    }
  }
  return undirected;
}

/**
 * Rank the candidate ids that lie in `scores` by descending relevance, breaking ties on
 * node id (the determinism tie-break). Candidates absent from `scores` (outside the bounded
 * universe / unreachable from the seeds) are dropped. Returns `{ id, relevance }` pairs.
 */
export function rankByRelevance(
  candidates: Iterable<string>,
  scores: Map<string, number>,
): Array<{ id: string; relevance: number }> {
  return [...new Set(candidates)]
    .filter(id => scores.has(id))
    .map(id => ({ id, relevance: scores.get(id)! }))
    .sort((a, b) => b.relevance - a.relevance || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}
