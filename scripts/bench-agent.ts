/**
 * Spec 14 — Agent Token-Efficiency Benchmark Harness (WITH vs WITHOUT openlore).
 *
 * Drives a HEADLESS agent (`claude -p --output-format json`) over a fixed task
 * suite against pinned OSS repos, once WITH the openlore MCP server configured
 * and once WITHOUT, and records tokens / tool-calls / cost / wall-clock so the
 * project's headline "orient replaces a file-by-file orientation pass" claim can
 * be MEASURED instead of asserted. Sibling to the latency benches
 * (`bench.ts`/`bench-mcp.ts`/`bench-watch.ts`) — it answers a different question
 * (end-to-end agent round-trips), and leaves them untouched.
 *
 *   npm run bench:agent -- --dry-run                 # validate the pipeline, $0, no agent calls
 *   npm run bench:agent -- --dry-run --verify-oracle # also grep each clone to confirm expected answers
 *   npm run bench:agent -- --runs 4 --model sonnet   # the real, paid run (needs agent auth)
 *
 * Scope contract (Spec 14): pure addition. No runtime/library/API change; the
 * existing benches and their npm entry points are unmodified.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { tmpdir } from 'node:os';
import { REPOS, TASKS, type PinnedRepo, type BenchTask } from './bench-agent.tasks.js';

// ── CLI args ────────────────────────────────────────────────────────────────
interface Opts {
  dryRun: boolean;
  verifyOracle: boolean;
  runs: number;
  model: string;
  repos?: Set<string>;
  tasks?: Set<string>;
  work: string;
  out: string;
  maxBudgetUsd: number;
  skipSetup: boolean;
}

function parseArgs(argv: string[]): Opts {
  const get = (flag: string): string | undefined => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const list = (flag: string): Set<string> | undefined => {
    const v = get(flag);
    return v ? new Set(v.split(',').map((s) => s.trim()).filter(Boolean)) : undefined;
  };
  return {
    dryRun: argv.includes('--dry-run'),
    verifyOracle: argv.includes('--verify-oracle'),
    runs: parseInt(get('--runs') ?? '4', 10),
    model: get('--model') ?? 'sonnet',
    repos: list('--repos'),
    tasks: list('--tasks'),
    work: get('--work') ?? join(tmpdir(), 'openlore-bench-agent'),
    out: get('--out') ?? join(process.cwd(), 'docs', 'AGENT-BENCHMARKS.md'),
    maxBudgetUsd: parseFloat(get('--max-budget-usd') ?? '2'),
    skipSetup: argv.includes('--skip-setup'),
  };
}

// ── Metrics ─────────────────────────────────────────────────────────────────
interface Metrics {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  costUsd: number;
  numTurns: number;     // round-trip proxy for tool-call count (json output exposes turns, not raw tool calls)
  durationMs: number;
  answer: string;
  correct: boolean;
  error?: string;
}

type Condition = 'without' | 'with';

// ── Repo setup (clone @ pinned SHA, analyze for the WITH index) ──────────────
function sh(cmd: string, args: string[], cwd?: string): string {
  return execFileSync(cmd, args, { cwd, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 });
}

function ensureRepo(repo: PinnedRepo, work: string): string {
  const dir = join(work, repo.id);
  if (!existsSync(join(dir, '.git'))) {
    mkdirSync(dir, { recursive: true });
    sh('git', ['init', '-q'], dir);
    sh('git', ['remote', 'add', 'origin', repo.url], dir);
  }
  // Fetch only the pinned commit's history shallowly, then check it out.
  sh('git', ['fetch', '-q', '--depth', '1', 'origin', repo.sha], dir);
  sh('git', ['checkout', '-q', repo.sha], dir);
  return dir;
}

function ensureAnalyzed(repoDir: string): void {
  if (existsSync(join(repoDir, '.openlore', 'analysis', 'llm-context.json'))) return;
  // `analyze` requires an .openlore/config.json — `init` creates it (idempotent).
  if (!existsSync(join(repoDir, '.openlore', 'config.json'))) {
    sh('openlore', ['init'], repoDir);
  }
  // Deterministic, no LLM, no network: BM25/structural index only.
  sh('openlore', ['analyze', '--no-embed'], repoDir);
}

/** WITH-condition MCP config: openlore server, one-shot (no watcher). */
function withMcpConfig(work: string): string {
  const cfg = { mcpServers: { openlore: { command: 'openlore', args: ['mcp', '--no-watch-auto'] } } };
  const p = join(work, 'openlore-mcp.json');
  writeFileSync(p, JSON.stringify(cfg, null, 2), 'utf-8');
  return p;
}

// ── Oracle verification (grep the clone for each expected substring) ─────────
function fileList(dir: string): string[] {
  const out: string[] = [];
  const skip = new Set(['.git', 'node_modules', '.openlore', 'dist', 'build', 'vendor']);
  const walk = (d: string) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      if (skip.has(e.name)) continue;
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(ts|tsx|js|jsx|py|go)$/.test(e.name)) out.push(p);
    }
  };
  walk(dir);
  return out;
}

/** True if `needle` appears as a path substring or as a token inside any source file. */
function oracleFound(repoDir: string, needle: string): boolean {
  const files = fileList(repoDir);
  if (files.some((f) => relative(repoDir, f).includes(needle))) return true;
  for (const f of files) {
    try {
      if (statSync(f).size < 2 * 1024 * 1024 && readFileSync(f, 'utf-8').includes(needle)) return true;
    } catch { /* skip */ }
  }
  return false;
}

// ── Agent driver ────────────────────────────────────────────────────────────
function score(task: BenchTask, answer: string): boolean {
  const a = answer.toLowerCase();
  return task.expect.mustInclude.every((s) => a.includes(s.toLowerCase()));
}

function runAgent(task: BenchTask, repoDir: string, condition: Condition, opts: Opts, mcpConfigPath: string, runIdx: number): Metrics {
  if (opts.dryRun) {
    // MOCK: exercise the scoring + aggregation pipeline at $0, no agent call.
    // WITH gets a fuller answer (includes the expected substrings) and fewer
    // round-trips than WITHOUT, so the table renders a representative shape.
    // These numbers are SYNTHETIC and never written to the committed results doc.
    const base = (task.id.length + runIdx) % 5;
    const withCond = condition === 'with';
    const answer = withCond
      ? `[mock] ${task.expect.mustInclude.join(', ')}`
      : `[mock] partial — ${task.expect.mustInclude.slice(0, 1).join(', ')}`;
    return {
      inputTokens: withCond ? 4000 + base * 100 : 14000 + base * 400,
      outputTokens: withCond ? 300 + base * 10 : 900 + base * 30,
      totalTokens: withCond ? 4300 + base * 110 : 14900 + base * 430,
      costUsd: withCond ? 0.012 + base * 0.001 : 0.045 + base * 0.003,
      numTurns: withCond ? 2 + (base % 2) : 6 + base,
      durationMs: withCond ? 9000 + base * 300 : 26000 + base * 900,
      answer,
      correct: score(task, answer),
    };
  }

  const args = [
    '-p', task.prompt,
    '--output-format', 'json',
    '--model', opts.model,
    '--max-budget-usd', String(opts.maxBudgetUsd),
    '--no-session-persistence',
  ];
  if (condition === 'with') args.push('--mcp-config', mcpConfigPath);

  const t0 = Date.now();
  let raw: string;
  try {
    raw = sh('claude', args, repoDir);
  } catch (err) {
    const e = err as { stdout?: Buffer | string; message?: string };
    const out = e.stdout ? e.stdout.toString() : '';
    if (!out) {
      return { inputTokens: 0, outputTokens: 0, totalTokens: 0, costUsd: 0, numTurns: 0, durationMs: Date.now() - t0, answer: '', correct: false, error: e.message ?? 'agent failed' };
    }
    raw = out; // some non-zero exits still emit the result json
  }

  const j = JSON.parse(raw) as Record<string, unknown>;
  const usage = (j.usage ?? {}) as Record<string, number>;
  const input = (usage.input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0);
  const output = usage.output_tokens ?? 0;
  const answer = String(j.result ?? '');
  return {
    inputTokens: input,
    outputTokens: output,
    totalTokens: input + output,
    costUsd: Number(j.total_cost_usd ?? 0),
    numTurns: Number(j.num_turns ?? 0),
    durationMs: Number(j.duration_ms ?? Date.now() - t0),
    answer,
    correct: score(task, answer),
  };
}

// ── Aggregation ─────────────────────────────────────────────────────────────
const median = (xs: number[]): number => {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

interface Cell { totalTokens: number; costUsd: number; numTurns: number; durationMs: number; correctRate: number; n: number; }
function summarize(runs: Metrics[]): Cell {
  return {
    totalTokens: median(runs.map((r) => r.totalTokens)),
    costUsd: median(runs.map((r) => r.costUsd)),
    numTurns: median(runs.map((r) => r.numTurns)),
    durationMs: median(runs.map((r) => r.durationMs)),
    correctRate: runs.length ? runs.filter((r) => r.correct).length / runs.length : 0,
    n: runs.length,
  };
}

// ── Report ──────────────────────────────────────────────────────────────────
function pct(withV: number, withoutV: number): string {
  if (withoutV === 0) return '—';
  const delta = (1 - withV / withoutV) * 100;
  return `${delta >= 0 ? '−' : '+'}${Math.abs(delta).toFixed(0)}%`;
}

function renderReport(
  opts: Opts,
  perTask: Array<{ task: BenchTask; without: Cell; with: Cell }>,
): string {
  const L: string[] = [];
  L.push('# Agent Token-Efficiency Benchmark (WITH vs WITHOUT openlore)');
  L.push('');
  L.push('> Generated by `npm run bench:agent`. Spec 14.');
  L.push(opts.dryRun ? '> **DRY RUN — synthetic mock numbers, not a real measurement.**' : '');
  L.push('');
  L.push('## Methodology');
  L.push('');
  L.push(`- **Agent:** \`claude -p --output-format json\`, model \`${opts.model}\`, ${opts.runs} run(s)/task, median reported.`);
  L.push('- **Conditions:** WITHOUT = agent with no openlore MCP (grep/read baseline). WITH = `--mcp-config` registering the openlore MCP server (`--no-watch-auto`), repo pre-analyzed via `openlore analyze --no-embed`.');
  L.push('- **Scoring:** correct = the agent\'s final answer contains every independently-verifiable expected substring (`expect.mustInclude` in `bench-agent.tasks.ts`), confirmed against the pinned source by grep — not derived from openlore\'s own graph.');
  L.push('- **Metrics:** total tokens (input incl. cache + output), cost (USD), round-trips (`num_turns`), wall-clock (ms).');
  L.push('');
  L.push('### Pinned repos');
  L.push('');
  L.push('| Repo | Lang | Tag | SHA |');
  L.push('|------|------|-----|-----|');
  for (const r of REPOS) L.push(`| ${r.id} | ${r.language} | ${r.tag} | \`${r.sha.slice(0, 12)}\` |`);
  L.push('');
  L.push('## Per-task results (median)');
  L.push('');
  L.push('| Task | Kind | Correct (wo/w) | Tokens wo | Tokens w | Δtok | Cost wo | Cost w | Turns wo | Turns w |');
  L.push('|------|------|----------------|-----------|----------|------|---------|--------|----------|---------|');
  for (const { task, without, with: w } of perTask) {
    L.push(
      `| ${task.id} | ${task.kind} | ${(without.correctRate * 100).toFixed(0)}% / ${(w.correctRate * 100).toFixed(0)}% ` +
      `| ${without.totalTokens.toFixed(0)} | ${w.totalTokens.toFixed(0)} | ${pct(w.totalTokens, without.totalTokens)} ` +
      `| $${without.costUsd.toFixed(3)} | $${w.costUsd.toFixed(3)} | ${without.numTurns.toFixed(0)} | ${w.numTurns.toFixed(0)} |`,
    );
  }
  L.push('');
  // Aggregate (relational tasks only — the control 'locate' task is where grep already wins).
  const relational = perTask.filter((p) => p.task.kind !== 'locate');
  const aggWoTok = median(relational.map((p) => p.without.totalTokens));
  const aggWTok = median(relational.map((p) => p.with.totalTokens));
  const aggWoTurns = median(relational.map((p) => p.without.numTurns));
  const aggWTurns = median(relational.map((p) => p.with.numTurns));
  L.push('## Aggregate — relational tasks (graph-favourable)');
  L.push('');
  L.push(`- **Tokens:** ${aggWoTok.toFixed(0)} → ${aggWTok.toFixed(0)} (${pct(aggWTok, aggWoTok)})`);
  L.push(`- **Round-trips:** ${aggWoTurns.toFixed(0)} → ${aggWTurns.toFixed(0)} (${pct(aggWTurns, aggWoTurns)})`);
  L.push('');
  L.push('> Spec 13 kill-signal: if the relational-task reduction is small, that is the earliest signal to re-weight toward the governance layer (specs 15+). Report losses honestly; do not bury this number.');
  L.push('');
  return L.join('\n');
}

// ── Main ────────────────────────────────────────────────────────────────────
async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));
  const repos = REPOS.filter((r) => !opts.repos || opts.repos.has(r.id));
  const tasks = TASKS.filter((t) => (!opts.tasks || opts.tasks.has(t.id)) && repos.some((r) => r.id === t.repo));

  console.error(`[bench-agent] ${opts.dryRun ? 'DRY RUN ' : ''}${tasks.length} task(s) over ${repos.length} repo(s), ${opts.runs} run(s) each, model=${opts.model}`);
  if (!opts.dryRun) {
    console.error('[bench-agent] LIVE run — this makes real, paid agent calls. Ctrl-C now to abort.');
  }

  mkdirSync(opts.work, { recursive: true });
  const mcpConfigPath = withMcpConfig(opts.work);

  // Setup: clone @ SHA + analyze (skip with --skip-setup to reuse a prior setup).
  const repoDirs = new Map<string, string>();
  for (const repo of repos) {
    const dir = opts.skipSetup ? join(opts.work, repo.id) : ensureRepo(repo, opts.work);
    if (!opts.skipSetup) ensureAnalyzed(dir);
    repoDirs.set(repo.id, dir);
    console.error(`[bench-agent] ready: ${repo.id} @ ${repo.sha.slice(0, 8)}`);
  }

  // Optional oracle verification: every expected substring must exist in the clone.
  if (opts.verifyOracle) {
    let bad = 0;
    for (const task of tasks) {
      const dir = repoDirs.get(task.repo)!;
      for (const needle of task.expect.mustInclude) {
        const ok = oracleFound(dir, needle);
        if (!ok) { bad++; console.error(`[oracle] MISSING in ${task.repo}: "${needle}" (task ${task.id})`); }
      }
    }
    console.error(bad === 0 ? '[oracle] all expected answers found in pinned sources ✓' : `[oracle] ${bad} expected answer(s) NOT found — fix bench-agent.tasks.ts`);
  }

  // Run.
  const perTask: Array<{ task: BenchTask; without: Cell; with: Cell }> = [];
  for (const task of tasks) {
    const dir = repoDirs.get(task.repo)!;
    const without: Metrics[] = [];
    const withRuns: Metrics[] = [];
    for (let i = 0; i < opts.runs; i++) {
      without.push(runAgent(task, dir, 'without', opts, mcpConfigPath, i));
      withRuns.push(runAgent(task, dir, 'with', opts, mcpConfigPath, i));
    }
    perTask.push({ task, without: summarize(without), with: summarize(withRuns) });
    console.error(`[bench-agent] done: ${task.id}`);
  }

  const report = renderReport(opts, perTask);
  if (opts.dryRun) {
    // Never overwrite the committed results doc with mock numbers.
    process.stdout.write(report + '\n');
    console.error('[bench-agent] dry run complete — report printed to stdout (committed doc untouched).');
  } else {
    writeFileSync(opts.out, report, 'utf-8');
    console.error(`[bench-agent] wrote ${opts.out}`);
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
