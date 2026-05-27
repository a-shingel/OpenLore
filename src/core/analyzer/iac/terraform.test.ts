import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { extractTerraform } from './terraform.js';
import { projectIacGraph } from './project.js';

const dir = join(__dirname, 'fixtures', 'terraform');
function load(rel: string) {
  return { path: `terraform/${rel}`, content: readFileSync(join(dir, rel), 'utf-8') };
}

describe('terraform extraction', () => {
  const graph = extractTerraform([load('main.tf'), load('network/vpc.tf')]);

  it('extracts resources, data, modules, variables, outputs, providers', () => {
    const addrs = graph.resources.map(r => r.address).sort();
    expect(addrs).toContain('aws_s3_bucket.logs');
    expect(addrs).toContain('aws_s3_bucket_policy.logs_policy');
    expect(addrs).toContain('data.aws_iam_policy_document.logs');
    expect(addrs).toContain('module.network');
    expect(addrs).toContain('var.region');
    expect(addrs).toContain('var.bucket_name');
    expect(addrs).toContain('output.bucket_arn');
    expect(addrs).toContain('provider.aws');
    expect(addrs).toContain('aws_vpc.main');
    expect(addrs).toContain('aws_subnet.public');
  });

  it('marks provider as external', () => {
    expect(graph.resources.find(r => r.address === 'provider.aws')?.isExternal).toBe(true);
  });

  it('resolves references and depends_on edges', () => {
    const refs = graph.references.map(r => `${r.fromAddress} -${r.kind}-> ${r.toAddress}`).sort();
    expect(refs).toContain('aws_s3_bucket_policy.logs_policy -references-> aws_s3_bucket.logs');
    expect(refs).toContain('aws_s3_bucket_policy.logs_policy -depends_on-> aws_s3_bucket.logs');
    expect(refs).toContain('aws_s3_bucket_policy.logs_policy -references-> data.aws_iam_policy_document.logs');
    expect(refs).toContain('output.bucket_arn -references-> aws_s3_bucket.logs');
    expect(refs).toContain('aws_subnet.public -references-> aws_vpc.main');
    expect(refs).toContain('aws_s3_bucket.logs -references-> var.bucket_name');
  });

  it('links a local module source to the module dir resources', () => {
    const refs = graph.references.map(r => `${r.fromAddress} -${r.kind}-> ${r.toAddress}`);
    expect(refs).toContain('module.network -depends_on-> aws_vpc.main');
    expect(refs).toContain('module.network -depends_on-> aws_subnet.public');
  });

  it('projects onto FunctionNode/CallEdge with blast-radius direction', () => {
    const projected = projectIacGraph(graph);
    // analyze_impact on a base resource: who depends on aws_s3_bucket.logs?
    const bucket = projected.nodes.find(n => n.name === 'aws_s3_bucket.logs')!;
    const dependents = projected.edges.filter(e => e.calleeId === bucket.id).map(e => {
      return projected.nodes.find(n => n.id === e.callerId)?.name;
    });
    expect(dependents).toContain('aws_s3_bucket_policy.logs_policy');
    expect(dependents).toContain('output.bucket_arn');
    expect(bucket.language).toBe('Terraform');
    expect(bucket.className).toBe('aws_s3_bucket');
  });
});
