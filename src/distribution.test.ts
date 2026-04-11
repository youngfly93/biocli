import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');

describe('distribution scaffolding', () => {
  it('keeps conda recipe version in sync with package.json', () => {
    const pkg = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8')) as { version: string };
    const recipe = readFileSync(resolve(ROOT, 'packaging/conda/recipe/meta.yaml'), 'utf8');

    expect(recipe).toContain(`{% set version = "${pkg.version}" %}`);
    expect(recipe).toContain('name: {{ name|lower }}');
    expect(recipe).toContain('path: ../../..');
    expect(recipe).toContain('nodejs >=20');
    expect(recipe).not.toContain('\n    - npm\n');
    expect(recipe).not.toContain('\n  script:\n');
  });

  it('documents the preferred conda install path in README', () => {
    const readme = readFileSync(resolve(ROOT, 'README.md'), 'utf8');
    expect(readme).toContain('conda install -c bioconda -c conda-forge biocli');
    expect(readme).toContain('packaging/conda/README.md');
    expect(readme).toContain('packages/biocli-mcp');
    expect(readme).toContain('npm run verify:conda');
  });

  it('keeps the standalone conda verification helper green', () => {
    const output = execFileSync('node', ['scripts/verify-conda-scaffold.cjs'], {
      cwd: ROOT,
      encoding: 'utf8',
    });

    expect(output).toContain('conda scaffold verification passed');
  });
});
