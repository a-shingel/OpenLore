/**
 * Helm chart extraction (spec-07).
 *
 * A chart is a directory containing `Chart.yaml`. We parse Chart.yaml
 * (name + dependencies), and the templates under `templates/`. Templates are
 * Go-templated YAML, not valid YAML as-is, so we run a tolerant pre-pass that
 * masks `{{ … }}` (never executing it) so the structure parses best-effort.
 *
 * Edges: chart → subchart dependency (external unless vendored under charts/),
 * and template → named-template (`include`/`template` → `define`) references.
 * Template → .Values references are a spec-07 follow-up.
 * TODO(spec-07-followup): resolve `.Values.x` references to values.yaml keys.
 */

import { dirname, posix as posixPath } from 'node:path';
import { parseAllDocuments } from 'yaml';
import type { IacGraph, IacModule } from './types.js';
import { emptyIacGraph } from './types.js';

interface InFile { path: string; content: string }

export function extractHelm(files: InFile[]): IacGraph {
  const graph = emptyIacGraph();
  const chartRoots = files
    .filter((f) => /(^|\/)Chart\.ya?ml$/.test(f.path.replace(/\\/g, '/')))
    .map((f) => posixPath.normalize(dirname(f.path.replace(/\\/g, '/'))));

  const fileChart = (path: string): string | null => {
    const p = posixPath.normalize(path.replace(/\\/g, '/'));
    let best: string | null = null;
    for (const root of chartRoots) {
      if ((p === root || p.startsWith(root + '/')) && (best === null || root.length > best.length)) best = root;
    }
    return best;
  };

  // Group files by chart root.
  const byChart = new Map<string, InFile[]>();
  for (const f of files) {
    const root = fileChart(f.path);
    if (!root) continue;
    if (!byChart.has(root)) byChart.set(root, []);
    byChart.get(root)!.push(f);
  }

  for (const [root, chartFiles] of byChart) {
    extractChart(root, chartFiles, chartRoots, graph);
  }
  return graph;
}

function extractChart(root: string, chartFiles: InFile[], allChartRoots: string[], graph: IacGraph): void {
  const chartYaml = chartFiles.find((f) => /(^|\/)Chart\.ya?ml$/.test(f.path.replace(/\\/g, '/')));
  if (!chartYaml) return;

  let meta: Record<string, unknown> = {};
  try {
    const docs = parseAllDocuments(chartYaml.content);
    meta = (docs[0]?.toJS() ?? {}) as Record<string, unknown>;
  } catch { /* tolerate */ }
  const chartName = typeof meta.name === 'string' ? meta.name : posixPath.basename(root);
  const chartAddr = `chart.${chartName}`;

  const module: IacModule = {
    address: chartAddr, type: 'chart', filePath: chartYaml.path, language: 'Helm', members: [],
  };
  graph.modules.push(module);
  graph.resources.push({
    address: chartAddr, type: 'chart', kind: 'module', filePath: chartYaml.path,
    startLine: 1, signature: `chart: ${chartName}`, language: 'Helm',
  });

  // Subchart dependencies.
  const deps = Array.isArray(meta.dependencies) ? meta.dependencies as Array<Record<string, unknown>> : [];
  for (const dep of deps) {
    const depName = typeof dep.name === 'string' ? dep.name : undefined;
    if (!depName) continue;
    const alias = typeof dep.alias === 'string' ? dep.alias : depName;
    const depAddr = `chart.${alias}`;
    const vendored = allChartRoots.some((r) => r === posixPath.normalize(`${root}/charts/${depName}`));
    if (!graph.resources.some((r) => r.address === depAddr)) {
      graph.resources.push({
        address: depAddr, type: 'chart', kind: 'module', filePath: chartYaml.path,
        startLine: 1, isExternal: vendored ? undefined : true,
        signature: `subchart: ${alias}`, language: 'Helm',
      });
    }
    graph.references.push({ fromAddress: chartAddr, toAddress: depAddr, kind: 'depends_on' });
    module.members.push(depAddr);
  }

  // Named templates (define) and includes across templates/_helpers.
  for (const f of chartFiles) {
    const rel = posixPath.relative(root, posixPath.normalize(f.path.replace(/\\/g, '/')));
    if (!/(^|\/)templates\//.test(f.path.replace(/\\/g, '/'))) continue;

    // define "NAME"
    for (const m of f.content.matchAll(/\{\{-?\s*define\s+"([^"]+)"/g)) {
      const defAddr = `${chartName}:define:${m[1]}`;
      if (!graph.resources.some((r) => r.address === defAddr)) {
        graph.resources.push({
          address: defAddr, type: 'template', kind: 'value', filePath: f.path,
          startLine: lineOfIndex(f.content, m.index ?? 0),
          signature: `define "${m[1]}"`, language: 'Helm',
        });
        module.members.push(defAddr);
      }
    }

    // template-file anchor node (source of include edges + best-effort manifests).
    const anchorAddr = `${chartName}:tpl:${rel}`;
    graph.resources.push({
      address: anchorAddr, type: 'template', kind: 'manifest', filePath: f.path,
      startLine: 1, signature: `template: ${rel}`, language: 'Helm',
    });
    module.members.push(anchorAddr);

    // include "NAME" / template "NAME" → reference to the define node.
    const seen = new Set<string>();
    for (const m of f.content.matchAll(/\{\{-?\s*(?:include|template)\s+"([^"]+)"/g)) {
      const defAddr = `${chartName}:define:${m[1]}`;
      if (seen.has(defAddr)) continue;
      seen.add(defAddr);
      graph.references.push({ fromAddress: anchorAddr, toAddress: defAddr, kind: 'references' });
    }

    // Best-effort manifest extraction (tolerant masked parse).
    extractTemplateManifests(f, chartName, module, graph);
  }
}

function extractTemplateManifests(f: InFile, chartName: string, module: IacModule, graph: IacGraph): void {
  const masked = maskHelm(f.content);
  let docs;
  try {
    docs = parseAllDocuments(masked);
  } catch {
    return;
  }
  for (const doc of docs) {
    let obj: Record<string, unknown> | null = null;
    try { obj = doc.toJS() as Record<string, unknown> | null; } catch { continue; }
    if (!obj || typeof obj !== 'object') continue;
    const kind = typeof obj.kind === 'string' ? obj.kind : '';
    const meta = (obj.metadata ?? {}) as Record<string, unknown>;
    const name = typeof meta.name === 'string' ? meta.name : '';
    if (!kind || !name) continue;
    const addr = `${chartName}:${kind}/${name}`;
    if (graph.resources.some((r) => r.address === addr)) continue;
    graph.resources.push({
      address: addr, type: kind, kind: 'manifest', filePath: f.path,
      startLine: 1, signature: `${kind}/${name} (templated)`, language: 'Helm',
    });
    module.members.push(addr);
  }
}

/** Mask Go-template directives so the YAML structure parses (never executed). */
function maskHelm(content: string): string {
  return content
    .split('\n')
    .map((line) => {
      const trimmed = line.trim();
      // Drop whole-line control directives ({{ if }}, {{ end }}, {{- range }}, …).
      if (/^\{\{-?.*-?\}\}$/.test(trimmed) && /\b(if|else|end|range|with|define|template|include|toYaml|nindent)\b/.test(trimmed)) {
        return '';
      }
      // Replace inline expressions with a placeholder scalar.
      return line.replace(/\{\{-?[\s\S]*?-?\}\}/g, 'helmval');
    })
    .join('\n');
}

function lineOfIndex(content: string, index: number): number {
  let n = 1;
  for (let i = 0; i < index && i < content.length; i++) if (content[i] === '\n') n++;
  return n;
}
