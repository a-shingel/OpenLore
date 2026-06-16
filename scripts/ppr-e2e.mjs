#!/usr/bin/env node
/**
 * E2E + acceptance harness for the personalized-PageRank ranking mode.
 * Drives the COMPILED handlers (dist/) against a really-analyzed repo, in both
 * default (distance) and opt-in pagerank modes, and reports:
 *   - default byte-identity (rankBy omitted === rankBy:"distance")
 *   - determinism (pagerank run twice is byte-identical)
 *   - seed-relativity (two targets give different orderings)
 *   - budget fitting + overflow reporting
 *   - a head-to-head on where the two rankers DISAGREE (the lift signal)
 *
 * Usage: node scripts/ppr-e2e.mjs <absDir> <fn1> <fn2> ...
 */
import { dispatchTool } from '../dist/core/services/tool-dispatch.js';

const [, , dir, ...fns] = process.argv;
if (!dir) { console.error('usage: ppr-e2e.mjs <absDir> <fn>...'); process.exit(1); }

const j = (x) => JSON.stringify(x);
const ok = (b) => (b ? 'PASS' : 'FAIL');
let failures = 0;
const check = (label, cond) => { if (!cond) failures++; console.log(`  [${ok(cond)}] ${label}`); };

async function gmc(fn, opts = {}) {
  return dispatchTool('get_minimal_context', { directory: dir, functionName: fn, ...opts }, dir);
}

console.log(`\n=== get_minimal_context: ${dir} ===`);
for (const fn of fns) {
  const def = await gmc(fn);
  if (def?.error) { console.log(`\n# ${fn}: ${def.error}`); continue; }
  const distExplicit = await gmc(fn, { rankBy: 'distance' });
  const pr1 = await gmc(fn, { rankBy: 'pagerank' });
  const pr2 = await gmc(fn, { rankBy: 'pagerank' });

  const callerN = def.callers?.length ?? 0;
  const calleeN = def.callees?.length ?? 0;
  console.log(`\n# ${fn}  (callers=${callerN}, callees=${calleeN}, risk=${def.function?.riskLevel})`);
  check('default omitted === rankBy:distance (byte-identical)', j(def) === j(distExplicit));
  check('default carries no rankedBy/relevance', !def.rankedBy && (def.callers ?? []).every(c => c.relevance === undefined));
  check('pagerank deterministic across runs', j(pr1) === j(pr2));
  check('pagerank attaches rankedBy + relevance', pr1.rankedBy === 'pagerank' && (pr1.callers ?? []).every(c => typeof c.relevance === 'number'));

  // Disagreement = the lift signal: where does pagerank promote a neighbour the
  // distance ranker ranked lower? Report the top-3 of each for inspection.
  const top = (xs) => (xs ?? []).slice(0, 5).map(c => c.name);
  const dC = top(def.callers), pC = top(pr1.callers);
  if (j(dC) !== j(pC)) {
    console.log(`    callers  distance: ${j(dC)}`);
    console.log(`    callers  pagerank: ${j(pC)}`);
  } else {
    console.log(`    callers  identical top-5 ordering`);
  }
  const dE = top(def.callees), pE = top(pr1.callees);
  if (j(dE) !== j(pE)) {
    console.log(`    callees  distance: ${j(dE)}`);
    console.log(`    callees  pagerank: ${j(pE)}`);
  } else {
    console.log(`    callees  identical top-5 ordering`);
  }

  // Budget fitting: pick a budget that forces overflow, confirm it reports + fits.
  if (callerN + calleeN > 2) {
    const budgeted = await gmc(fn, { rankBy: 'pagerank', tokenBudget: 60 });
    const fitFewer = (budgeted.callers?.length ?? 0) <= callerN;
    check('budget reports omittedForBudget when it cuts', !budgeted.omittedForBudget || (budgeted.omittedForBudget.callers + budgeted.omittedForBudget.callees) > 0);
    check('budget keeps >=1 and never grows the set', (budgeted.callers?.length ?? 0) >= 1 && fitFewer);
  }
}

// Seed-relativity across two targets (different seeds ⇒ different rankings).
if (fns.length >= 2) {
  const a = await gmc(fns[0], { rankBy: 'pagerank' });
  const b = await gmc(fns[1], { rankBy: 'pagerank' });
  if (!a.error && !b.error) {
    console.log(`\n# seed-relativity: ${fns[0]} vs ${fns[1]}`);
    const relA = (a.callers ?? []).map(c => `${c.name}:${c.relevance}`);
    const relB = (b.callers ?? []).map(c => `${c.name}:${c.relevance}`);
    check('different seeds produce different caller relevance vectors', j(relA) !== j(relB));
  }
}

console.log(`\n=== ${failures === 0 ? 'ALL CHECKS PASS' : failures + ' CHECK(S) FAILED'} ===`);
process.exit(failures === 0 ? 0 : 1);
