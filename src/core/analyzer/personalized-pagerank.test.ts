/**
 * Personalized PageRank primitive — spec: QueryConditionedPageRankRanking.
 *
 * Covers the deterministic-ranker scenarios from the change
 * add-personalized-pagerank-context-ranking: query-relative ordering, connectivity
 * outranking shortest distance, run-to-run determinism (including tied nodes), the
 * no-new-tuning-constant guarantee, the seed-set requirement, and bounded computation.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  personalizedPageRank,
  rankByRelevance,
  mergeUndirected,
  type WeightedAdjacency,
} from './personalized-pagerank.js';
import {
  PAGERANK_DAMPING_FACTOR,
  PAGERANK_CONVERGENCE_TOLERANCE,
} from '../../constants.js';

/** Build a directed weighted adjacency from `a->b` edge strings (cost defaults to 1). */
function adj(edges: Array<[string, string]>): WeightedAdjacency {
  const m: WeightedAdjacency = new Map();
  for (const [from, to] of edges) {
    if (!m.has(from)) m.set(from, []);
    m.get(from)!.push({ to, cost: 1 });
  }
  return m;
}

function universeOf(edges: Array<[string, string]>): Set<string> {
  const u = new Set<string>();
  for (const [a, b] of edges) { u.add(a); u.add(b); }
  return u;
}

describe('personalizedPageRank', () => {
  it('Ranking is query-relative: different seeds give different orderings', () => {
    // Two clusters joined by a thin bridge. Each cluster is densely connected.
    const edges: Array<[string, string]> = [
      // cluster 1
      ['a1', 'a2'], ['a2', 'a3'], ['a3', 'a1'], ['a1', 'a3'],
      // cluster 2
      ['b1', 'b2'], ['b2', 'b3'], ['b3', 'b1'], ['b1', 'b3'],
      // bridge
      ['a1', 'b1'], ['b1', 'a1'],
    ];
    const graph = mergeUndirected(adj(edges), new Map());
    const universe = universeOf(edges);

    const fromA = personalizedPageRank(graph, ['a1'], universe);
    const fromB = personalizedPageRank(graph, ['b1'], universe);

    // A node in cluster 1 ranks higher when seeded from cluster 1 than from cluster 2.
    expect(fromA.get('a3')!).toBeGreaterThan(fromB.get('a3')!);
    // And symmetrically for cluster 2.
    expect(fromB.get('b3')!).toBeGreaterThan(fromA.get('b3')!);

    // The two rankings genuinely differ.
    const orderA = rankByRelevance(universe, fromA).map(r => r.id);
    const orderB = rankByRelevance(universe, fromB).map(r => r.id);
    expect(orderA).not.toEqual(orderB);
  });

  it('Connectivity outranks shortest distance: many paths beat a single path at equal distance', () => {
    // A and B are both at shortest distance 2 from the seed S, but A is reachable by
    // three independent 2-hop paths and B by exactly one.
    const edges: Array<[string, string]> = [
      ['S', 'm1'], ['S', 'm2'], ['S', 'm3'], // three independent intermediates
      ['m1', 'A'], ['m2', 'A'], ['m3', 'A'],  // ...all converging on A
      ['S', 'n1'], ['n1', 'B'],               // a single path to B
    ];
    const graph = adj(edges);
    const universe = universeOf(edges);

    const scores = personalizedPageRank(graph, ['S'], universe);

    // Same shortest distance, but the many-paths candidate ranks strictly higher.
    expect(scores.get('A')!).toBeGreaterThan(scores.get('B')!);
  });

  it('Ranking is deterministic across runs, including the order of tied nodes', () => {
    // A symmetric star: the three leaves are perfectly tied, so only the id tie-break
    // can order them — and it must order them identically every run.
    const edges: Array<[string, string]> = [
      ['hub', 'leafC'], ['hub', 'leafA'], ['hub', 'leafB'],
      ['leafA', 'hub'], ['leafB', 'hub'], ['leafC', 'hub'],
    ];
    const graph = adj(edges);
    const universe = universeOf(edges);

    const first = rankByRelevance(universe, personalizedPageRank(graph, ['hub'], universe));
    const second = rankByRelevance(universe, personalizedPageRank(graph, ['hub'], universe));

    expect(second).toEqual(first);
    // Tied leaves resolve by ascending id.
    const leaves = first.filter(r => r.id.startsWith('leaf')).map(r => r.id);
    expect(leaves).toEqual([...leaves].sort());
  });

  it('No new tuning constant is introduced: damping/tolerance come from the shared constants', () => {
    // The canonical values, defined once and shared with the file-level PageRank.
    expect(PAGERANK_DAMPING_FACTOR).toBe(0.85);
    expect(PAGERANK_CONVERGENCE_TOLERANCE).toBe(1e-6);

    // The implementation must not hard-code its own damping/tolerance literals — it must
    // reference the shared constants, so there is a single source of truth.
    const src = readFileSync(join(__dirname, 'personalized-pagerank.ts'), 'utf-8');
    expect(src).toMatch(/PAGERANK_DAMPING_FACTOR/);
    expect(src).toMatch(/PAGERANK_CONVERGENCE_TOLERANCE/);
    expect(src).not.toMatch(/0\.85/);
    expect(src).not.toMatch(/1e-6/);
  });

  it('PageRank requires a seed set: empty or out-of-universe seeds return no ranking', () => {
    const edges: Array<[string, string]> = [['x', 'y'], ['y', 'z']];
    const graph = adj(edges);
    const universe = universeOf(edges);

    expect(personalizedPageRank(graph, [], universe).size).toBe(0);
    // A seed that lies outside the bounded universe is not a global ranking — empty.
    expect(personalizedPageRank(graph, ['not-in-universe'], universe).size).toBe(0);
  });

  it('Bounded computation: scoring is confined to the supplied neighbourhood', () => {
    const edges: Array<[string, string]> = [
      ['S', 'near'], ['near', 'far'], ['far', 'farther'],
    ];
    const graph = adj(edges);
    // Universe deliberately excludes `farther` — e.g. the distance-bounded neighbourhood.
    const bounded = new Set(['S', 'near', 'far']);

    const scores = personalizedPageRank(graph, ['S'], bounded);

    expect(scores.has('near')).toBe(true);
    expect(scores.has('far')).toBe(true);
    expect(scores.has('farther')).toBe(false); // outside the bound — never scored
  });

  it('forms a probability distribution over the universe (sums to ~1)', () => {
    const edges: Array<[string, string]> = [
      ['S', 'a'], ['a', 'b'], ['b', 'c'], ['c', 'a'],
    ];
    const graph = adj(edges);
    const universe = universeOf(edges);
    const scores = personalizedPageRank(graph, ['S'], universe);
    const total = [...scores.values()].reduce((x, y) => x + y, 0);
    expect(total).toBeCloseTo(1, 5);
  });
});
