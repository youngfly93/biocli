import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { validateAll, validateYamlCli } from './validate.js';

describe('validateYamlCli', () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  function makeFile(name: string, content: string): string {
    const dir = mkdtempSync(join(tmpdir(), 'biocli-validate-'));
    tempDirs.push(dir);
    const path = join(dir, name);
    writeFileSync(path, content);
    return path;
  }

  it('reports YAML parse errors', () => {
    const file = makeFile('broken.yaml', 'description: ok:\n  - bad');
    expect(validateYamlCli(file)[0]).toMatch(/Invalid YAML/);
  });

  it('reports missing description, invalid strategy, bad arg type, bad timeout, and bad columns', () => {
    const file = makeFile('invalid.yaml', `
strategy: secret
args:
  query:
    type: float
columns: wrong
timeout: -1
`);
    expect(validateYamlCli(file)).toEqual(expect.arrayContaining([
      'Missing "description" field',
      expect.stringContaining('Invalid strategy "secret"'),
      expect.stringContaining('Arg "query": invalid type "float"'),
      '"columns" must be an array of strings',
      '"timeout" must be a positive number (seconds)',
    ]));
  });

  it('reports unknown pipeline steps and non-object steps', () => {
    const file = makeFile('pipeline.yaml', `
description: Test pipeline
pipeline:
  - unknown-step:
      url: https://example.com
  - just-a-string
  - {}
`);
    expect(validateYamlCli(file)).toEqual(expect.arrayContaining([
      expect.stringContaining('unknown step "unknown-step"'),
      'Pipeline step 1: must be an object',
      'Pipeline step 2: empty step object',
    ]));
  });

  it('accepts a structurally valid YAML command', () => {
    const file = makeFile('good.yaml', `
description: Search a gene
strategy: public
args:
  query:
    type: string
columns:
  - symbol
  - geneId
timeout: 15
pipeline:
  - fetch:
      url: https://example.com
`);
    expect(validateYamlCli(file)).toEqual([]);
  });
});

describe('validateAll', () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  function makeCliTree(): string {
    const root = mkdtempSync(join(tmpdir(), 'biocli-validate-all-'));
    tempDirs.push(root);
    mkdirSync(join(root, 'pubmed'), { recursive: true });
    mkdirSync(join(root, '.hidden-site'));
    mkdirSync(join(root, '_private-site'));
    return root;
  }

  it('returns empty results for a missing directory', () => {
    expect(validateAll(join(tmpdir(), 'biocli-does-not-exist'))).toEqual([]);
  });

  it('scans site directories, skips hidden files, and reports only invalid YAML files', () => {
    const root = makeCliTree();

    writeFileSync(join(root, 'pubmed', 'search.yaml'), 'description: ok\npipeline:\n  - fetch: {}\n');
    writeFileSync(join(root, 'pubmed', 'broken.yaml'), 'description: nope\npipeline:\n  - nope: {}\n');
    writeFileSync(join(root, 'pubmed', '.hidden.yaml'), 'description: hidden\npipeline:\n  - nope: {}\n');
    writeFileSync(join(root, 'pubmed', '._appledouble.yaml'), 'description: hidden\npipeline:\n  - nope: {}\n');
    writeFileSync(join(root, 'pubmed', 'ignore.txt'), 'not yaml');

    const results = validateAll(root);
    expect(results).toHaveLength(1);
    expect(results[0]?.file).toBe(join(root, 'pubmed', 'broken.yaml'));
    expect(results[0]?.errors[0]).toContain('unknown step "nope"');
  });
});
