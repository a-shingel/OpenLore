# Agent Token-Efficiency Benchmark (WITH vs WITHOUT openlore)

> Spec 14. This document holds the **end-to-end agent** benchmark — does configuring the
> openlore MCP server reduce the tokens / round-trips / cost / wall-clock a headless agent
> spends to answer relational questions about a codebase? It is distinct from
> [scripts/BENCHMARKS.md](../scripts/BENCHMARKS.md), which measures raw query/handler **latency**
> (orient ~430µs p50) — plumbing, not an agent outcome.

## Status

**Results pending a paid run.** The harness, task suite, pinned repos, and scoring are committed
and have been validated end-to-end at **$0** via `--dry-run` (clone → analyze → oracle-grep →
score → aggregate → report, with the agent call mocked). The numbers below are **not yet measured**
— the README token-savings claim is marked a hypothesis until a real run replaces this section.

This honest gap is deliberate: per Spec 14, we do not publish a number we have not measured, and per
Spec 13 this benchmark is the **kill-signal instrument** — if the measured reduction on relational
tasks turns out small, that is a real signal to re-weight toward the governance layer, not something
to bury.

## Reproduce

```bash
# Zero-cost pipeline check (no agent calls; confirms every expected answer exists in the pinned source):
npm run bench:agent -- --dry-run --verify-oracle

# The real, paid measurement (needs agent auth, e.g. ANTHROPIC_API_KEY or a logged-in `claude`):
npm run bench:agent -- --runs 4 --model sonnet
#   → writes the measured table into this file (docs/AGENT-BENCHMARKS.md).
```

Flags: `--repos a,b` / `--tasks x,y` to subset, `--max-budget-usd <n>` per-call cost cap,
`--work <dir>` for the clone cache, `--skip-setup` to reuse an existing clone+analysis.

## Methodology

- **Agent:** `claude -p --output-format json` (headless), a single pinned model, **N ≥ 4 runs per
  task**, median reported with the run count. Mirrors CodeGraph's published format (median of N≥4,
  ≥5 repos, headless, with/without) so the comparison is apples-to-apples.
- **Conditions:**
  - **WITHOUT** — the agent with no openlore MCP server (its native grep/read tools only). The baseline.
  - **WITH** — the same agent and prompt, plus `--mcp-config` registering the openlore MCP server
    (`openlore mcp --no-watch-auto`, one-shot). Each repo is pre-indexed with
    `openlore analyze --no-embed` (deterministic, no network, no LLM).
- **Scoring — correctness is separate from efficiency.** A run is *correct* only if the agent's final
  answer contains every expected substring for the task (`expect.mustInclude` in
  [`scripts/bench-agent.tasks.ts`](../scripts/bench-agent.tasks.ts)). Those expected answers are
  **independently verifiable** by reading the pinned source with grep — they are *not* derived from
  openlore's own call graph, so the WITH condition cannot win by parroting the tool under test.
  `--verify-oracle` greps each clone and fails loudly if any expected answer is absent (all current
  tasks pass). A cheap-but-wrong run is never counted as a win.
- **Metrics:** total tokens (input incl. cache + output), cost (USD), round-trips (`num_turns` from
  the agent's JSON — a proxy for tool-call count), wall-clock (ms).

### Pinned repos (SHAs resolved 2026-06-01 via `git ls-remote <url> refs/tags/<tag>`)

| Repo | Lang | Tag | SHA |
|------|------|-----|-----|
| chalk | TypeScript | v5.3.0 | `85e35510fdb8` |
| express | JavaScript | 4.19.2 | `d36495d7e666` |
| flask | Python | 3.0.3 | `85039283fc3e` |
| gin | Go | v1.10.0 | `75ccf94d605a` |
| zod | TypeScript | v3.23.8 | `ca42965df46b` |

### Task kinds

- **callers / blast-radius / call-path** — relational queries where a call graph is structurally
  cheaper than iterative grep+read. These are the graph-favourable tasks the aggregate focuses on.
- **locate** — a control ("where does feature X live"), where grep is already adequate. Included so the
  benchmark reports where openlore does *not* help, not only where it does.

The current suite is a starter set ([`scripts/bench-agent.tasks.ts`](../scripts/bench-agent.tasks.ts));
as the Layer-3 instruments ship (specs 19–23) their tasks — e.g. "which tests cover this change?" —
get added here so the benchmark measures the analysis layer, not just orientation.

## Results

_Pending the first paid run. `npm run bench:agent -- --runs 4` will replace this section with the
measured per-task and aggregate tables (including variance, not just medians)._
