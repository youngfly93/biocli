import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const TSX_CLI = resolve(ROOT, 'node_modules/tsx/dist/cli.mjs');
const MAIN = resolve(ROOT, 'src/main.ts');
const FETCH_MOCK = resolve(ROOT, 'tests/e2e/pubmed-fetch-mock.mjs');

const tempHomes: string[] = [];

function makeIsolatedHome(): string {
  const dir = mkdtempSync(resolve(tmpdir(), 'biocli-e2e-'));
  tempHomes.push(dir);
  return dir;
}

function runCli(args: string[], opts: { mockFetch?: boolean } = {}) {
  const homeDir = makeIsolatedHome();
  const nodeArgs = opts.mockFetch ? ['--import', FETCH_MOCK, TSX_CLI, MAIN, ...args] : [TSX_CLI, MAIN, ...args];

  return spawnSync(process.execPath, nodeArgs, {
    cwd: ROOT,
    encoding: 'utf8',
    env: {
      ...process.env,
      HOME: homeDir,
      XDG_CONFIG_HOME: homeDir,
    },
  });
}

describe('biocli e2e', () => {
  afterEach(() => {
    while (tempHomes.length > 0) {
      const dir = tempHomes.pop();
      if (dir) rmSync(dir, { recursive: true, force: true });
    }
  });

  it('runs pubmed fetch through the real CLI entrypoint', () => {
    const result = runCli(['pubmed', 'fetch', '36766853', '-f', 'json'], { mockFetch: true });
    expect(result.status).toBe(0);

    const rows = JSON.parse(result.stdout);
    expect(rows).toEqual([
      expect.objectContaining({
        pmid: '36766853',
        title: 'The Role of TP53 in Adaptation and Evolution.',
        abstract: expect.stringContaining('p53 protein acts as a transcription factor'),
      }),
    ]);
  });

  it('returns exit code 2 for invalid organism input', () => {
    const result = runCli(['aggregate', 'gene-dossier', 'TP53', '--organism', 'martian', '-f', 'json']);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('Unknown organism');
    expect(result.stderr).toContain('Hint:');
  });
});
