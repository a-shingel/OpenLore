/**
 * Spec-09 — analyze step + fact derivation.
 *
 * Ensures a cached repo is analyzed (init → analyze) so the tools have artifacts
 * to read, asserts those artifacts exist, then derives the realistic args
 * (`RepoFacts`) the tool driver feeds to function/file/query-scoped tools.
 *
 * Derivation reads the repo's OWN analysis (via deterministic read tools) so the
 * harness adapts to whatever repo it is pointed at — never hard-coded names.
 */

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { openloreInit } from '../../../../api/init.js';
import { openloreAnalyze } from '../../../../api/analyze.js';
import {
  ARTIFACT_LLM_CONTEXT,
  ARTIFACT_MAPPING,
  ARTIFACT_CALL_GRAPH_DB,
  ARTIFACT_REPO_STRUCTURE,
  OPENLORE_ANALYSIS_REL_PATH,
} from '../../../../constants.js';
import { dispatchTool } from '../../tool-dispatch.js';
import type { RepoFacts } from './tool-driver.js';

/** Artifacts every tool relies on; analyze must produce all of them. */
const REQUIRED_ARTIFACTS = [
  ARTIFACT_REPO_STRUCTURE,
  ARTIFACT_LLM_CONTEXT,
  ARTIFACT_MAPPING,
  ARTIFACT_CALL_GRAPH_DB,
];

/**
 * Run static analysis (no LLM) against a cached repo and assert artifacts exist.
 * @throws if any required artifact is missing after analyze (fail loudly).
 */
export async function analyzeRepo(dir: string): Promise<void> {
  await openloreInit({ rootPath: dir });
  await openloreAnalyze({ rootPath: dir, force: true });

  const analysisDir = join(dir, OPENLORE_ANALYSIS_REL_PATH);
  const missing = REQUIRED_ARTIFACTS.filter((a) => !existsSync(join(analysisDir, a)));
  if (missing.length) {
    throw new Error(
      `live-data: analyze produced no ${missing.join(', ')} in ${analysisDir} — analyze step failed for this repo.`,
    );
  }
}

/** Walk an arbitrary tool result for the first objects carrying a function name + file. */
function collectNamedFunctions(result: unknown, out: Array<{ name: string; file?: string }>): void {
  if (out.length >= 4 || result === null || typeof result !== 'object') return;
  if (Array.isArray(result)) {
    for (const item of result) collectNamedFunctions(item, out);
    return;
  }
  const obj = result as Record<string, unknown>;
  if (typeof obj.name === 'string' && obj.name.length > 0) {
    const file = typeof obj.file === 'string' ? obj.file : typeof obj.filePath === 'string' ? obj.filePath : undefined;
    out.push({ name: obj.name, file });
  }
  for (const v of Object.values(obj)) collectNamedFunctions(v, out);
}

async function safeDispatch(name: string, dir: string): Promise<unknown> {
  try {
    return await dispatchTool(name, { directory: dir }, dir);
  } catch {
    return null;
  }
}

/**
 * Derive realistic, deterministic args from the analyzed repo. Best-effort: any
 * fact that cannot be derived is left undefined, and tools needing it derive-skip
 * (distinct from a missing driver entry). Stable for a given repo+SHA.
 */
export async function deriveFacts(dir: string): Promise<RepoFacts> {
  const facts: RepoFacts = { directory: dir };

  // Prefer hubs (richest: name + file + ordering); fall back to leaf functions.
  const found: Array<{ name: string; file?: string }> = [];
  collectNamedFunctions(await safeDispatch('get_critical_hubs', dir), found);
  if (found.length < 2) collectNamedFunctions(await safeDispatch('get_leaf_functions', dir), found);

  // Deterministic pick: alphabetical-first names for stable snapshots/args.
  const byName = [...found].sort((a, b) => a.name.localeCompare(b.name));
  if (byName[0]) {
    facts.functionName = byName[0].name;
    facts.filePath = byName[0].file;
    // searchTerm derived from a real symbol — guaranteed to exist in the repo.
    facts.searchTerm = byName[0].name;
  }
  if (byName[1]) facts.secondFunction = byName[1].name;

  // Spec domain only if the repo actually ships specs (cloned OSS repos rarely do).
  const domains = await safeDispatch('list_spec_domains', dir);
  const domainList: string[] = [];
  collectStrings(domains, 'domain', domainList);
  collectStrings(domains, 'name', domainList);
  if (domainList[0]) facts.specDomain = domainList[0];

  return facts;
}

function collectStrings(result: unknown, key: string, out: string[]): void {
  if (out.length >= 8 || result === null || typeof result !== 'object') return;
  if (Array.isArray(result)) {
    for (const item of result) collectStrings(item, key, out);
    return;
  }
  const obj = result as Record<string, unknown>;
  if (typeof obj[key] === 'string' && (obj[key] as string).length > 0) out.push(obj[key] as string);
  for (const v of Object.values(obj)) collectStrings(v, key, out);
}
