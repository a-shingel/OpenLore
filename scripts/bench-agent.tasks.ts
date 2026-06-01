/**
 * Spec 14 — Agent benchmark: pinned repos + task suite.
 *
 * Data only (no behavior). Kept beside `bench-agent.ts` so the inputs a reviewer
 * must trust — which repos, which commit, which task, what counts as correct —
 * are in one auditable place.
 *
 * Reproducibility contract:
 *   • Every repo is pinned to a commit SHA (resolved from a release tag via
 *     `git ls-remote`), never a moving branch.
 *   • Every task has an INDEPENDENT, human-verifiable expected answer
 *     (`expect.mustInclude`) — a set of symbol/file substrings that any engineer
 *     can confirm by reading the pinned source with grep. The oracle is NOT
 *     derived from openlore's own graph, so the WITH condition cannot trivially
 *     "win" by parroting the tool it is being measured against.
 *   • Scoring is substring containment against the agent's final answer text:
 *     correct = it named the things the true answer requires. This separates
 *     CORRECTNESS (did it get the answer) from EFFICIENCY (tokens/tool-calls/
 *     cost/wall-clock) so a cheap-but-wrong run is never counted as a win.
 */

export interface PinnedRepo {
  /** short slug used in tables and as the clone dir name */
  id: string;
  /** git clone URL */
  url: string;
  /** release tag the SHA was resolved from (documentation only) */
  tag: string;
  /** pinned commit SHA — what actually gets checked out */
  sha: string;
  language: string;
}

export type TaskKind =
  | 'callers'       // enumerate callers of a symbol (relational — graph beats grep)
  | 'blast-radius'  // what breaks if this signature changes (relational)
  | 'call-path'     // is there a call path between two functions (relational)
  | 'locate';       // "where does feature X live" (control — grep is already fine)

export interface BenchTask {
  id: string;
  repo: string;     // PinnedRepo.id this task targets
  kind: TaskKind;
  /** the natural-language task handed verbatim to the headless agent */
  prompt: string;
  expect: {
    /**
     * Substrings the agent's final answer MUST contain to be scored correct.
     * Independently verifiable against the pinned source (grep), not via openlore.
     */
    mustInclude: string[];
    /** one-line human note on why this is the right answer (for the methodology doc) */
    rationale: string;
  };
}

// ── Pinned repos (SHAs resolved 2026-06-01 via `git ls-remote <url> refs/tags/<tag>`) ──
export const REPOS: PinnedRepo[] = [
  { id: 'chalk',   url: 'https://github.com/chalk/chalk',         tag: 'v5.3.0',  sha: '85e35510fdb85c028be09848ba80d863129ee054', language: 'TypeScript' },
  { id: 'express', url: 'https://github.com/expressjs/express',   tag: '4.19.2',  sha: 'd36495d7e666f30c06fbb0e039771c5267d7d1d4', language: 'JavaScript' },
  { id: 'flask',   url: 'https://github.com/pallets/flask',       tag: '3.0.3',   sha: '85039283fc3e986cced4ab39a3fe2b39314d06bb', language: 'Python' },
  { id: 'gin',     url: 'https://github.com/gin-gonic/gin',       tag: 'v1.10.0', sha: '75ccf94d605a05fe24817fc2f166f6f2959d5cea', language: 'Go' },
  { id: 'zod',     url: 'https://github.com/colinhacks/zod',      tag: 'v3.23.8', sha: 'ca42965df46b2f7e2747db29c40a26bcb32a51d5', language: 'TypeScript' },
];

/**
 * Task suite. STARTER set — the `mustInclude` answers are confirmed against the
 * pinned source during `--dry-run --verify-oracle` (which greps each clone and
 * flags any expected substring it cannot find). Expand per repo as Layer-3
 * instruments (specs 19–23) add their own task kinds.
 */
export const TASKS: BenchTask[] = [
  // express — JS, the canonical "who calls this" relational query
  {
    id: 'express-callers-router-route',
    repo: 'express', kind: 'callers',
    prompt: 'In this repository, which functions or files call `Router.prototype.route`? List the calling sites.',
    expect: {
      mustInclude: ['lib/router/index.js'],
      rationale: 'Router.prototype.route is invoked from the router index when building app routes.',
    },
  },
  {
    id: 'express-locate-content-negotiation',
    repo: 'express', kind: 'locate',
    prompt: 'Where is HTTP content negotiation (req.accepts and friends) implemented? Name the file(s).',
    expect: {
      mustInclude: ['lib/request.js'],
      rationale: 'req.accepts / acceptsCharsets / acceptsLanguages live on the request prototype.',
    },
  },
  // chalk — TS, relational on a small surface
  {
    id: 'chalk-callers-applyStyle',
    repo: 'chalk', kind: 'callers',
    prompt: 'Which functions call the internal `applyStyle` routine? Identify the call sites.',
    expect: {
      mustInclude: ['source/index.js'],
      rationale: 'applyStyle is called from the chained style builder in source/index.js.',
    },
  },
  // flask — Python, blast radius
  {
    id: 'flask-blast-radius-full-dispatch-request',
    repo: 'flask', kind: 'blast-radius',
    prompt: 'If the signature of `Flask.full_dispatch_request` changed, which functions would be affected (its callers)? List them.',
    expect: {
      mustInclude: ['wsgi_app'],
      rationale: 'full_dispatch_request is called by Flask.wsgi_app during request handling.',
    },
  },
  {
    id: 'flask-locate-blueprint-registration',
    repo: 'flask', kind: 'locate',
    prompt: 'Where are Blueprints registered onto the application? Name the file(s) and function(s).',
    expect: {
      mustInclude: ['register'],
      rationale: 'Blueprint.register / Flask.register_blueprint implement registration.',
    },
  },
  // gin — Go, relational
  {
    id: 'gin-callers-handleHTTPRequest',
    repo: 'gin', kind: 'callers',
    prompt: 'Which functions call `handleHTTPRequest`? List the call sites.',
    expect: {
      mustInclude: ['gin.go'],
      rationale: 'handleHTTPRequest is invoked from Engine.ServeHTTP in gin.go.',
    },
  },
  // zod — TS, call-path / locate
  {
    id: 'zod-locate-string-validation',
    repo: 'zod', kind: 'locate',
    prompt: 'Where is string schema validation (ZodString._parse) implemented? Name the file.',
    expect: {
      mustInclude: ['src/types.ts'],
      rationale: 'ZodString and its _parse live in src/types.ts in zod v3.',
    },
  },
];
