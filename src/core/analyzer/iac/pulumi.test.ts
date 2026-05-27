import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { extractPulumi } from './pulumi.js';

const base = join(__dirname, 'fixtures', 'pulumi');
const ts = { path: 'pulumi/index.ts', content: readFileSync(join(base, 'index.ts'), 'utf-8'), language: 'TypeScript' };
const py = { path: 'pulumi/__main__.py', content: readFileSync(join(base, '__main__.py'), 'utf-8'), language: 'Python' };

describe('pulumi detection', () => {
  it('detects two resources and a reference edge (TypeScript)', () => {
    const graph = extractPulumi([ts]);
    const addrs = graph.resources.map(r => r.address).sort();
    expect(addrs).toEqual(['Bucket:logs', 'BucketPolicy:logs-policy']);
    const refs = graph.references.map(r => `${r.fromAddress} -> ${r.toAddress}`);
    expect(refs).toContain('BucketPolicy:logs-policy -> Bucket:logs');
    expect(graph.resources[0].language).toBe('Pulumi');
  });

  it('detects two resources and a reference edge (Python)', () => {
    const graph = extractPulumi([py]);
    const addrs = graph.resources.map(r => r.address).sort();
    expect(addrs).toEqual(['Bucket:data', 'BucketPolicy:data-policy']);
    const refs = graph.references.map(r => `${r.fromAddress} -> ${r.toAddress}`);
    expect(refs).toContain('BucketPolicy:data-policy -> Bucket:data');
  });

  it('ignores files without a Pulumi provider import', () => {
    const graph = extractPulumi([{ path: 'app.ts', content: 'const x = new Foo("y", {});', language: 'TypeScript' }]);
    expect(graph.resources).toHaveLength(0);
  });
});
