import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Command } from 'commander';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir, tmpdir } from 'node:os';

const { executeCommandMock, renderMock } = vi.hoisted(() => ({
  executeCommandMock: vi.fn(),
  renderMock: vi.fn(),
}));

vi.mock('./execution.js', () => ({
  executeCommand: executeCommandMock,
}));

vi.mock('./output.js', () => ({
  render: renderMock,
}));

vi.mock('./progress.js', () => ({
  runWithProgressReporter: async (_reporter: (message: string) => void, fn: () => Promise<unknown>) => fn(),
}));

vi.mock('./spinner.js', () => ({
  startSpinner: () => ({
    update: () => undefined,
    stop: () => undefined,
  }),
}));

import { registerCommandToProgram } from './commander-adapter.js';

const originalHome = process.env.HOME;
let suiteHome = '';

function restoreHome(): void {
  if (originalHome == null) {
    delete process.env.HOME;
  } else {
    process.env.HOME = originalHome;
  }
}

function cleanupCache(): void {
  rmSync(join(homedir(), '.biocli', 'cache', 'gene'), { recursive: true, force: true });
}

function makeProgram(): Command {
  const program = new Command();
  const siteCmd = program.command('gene');
  registerCommandToProgram(siteCmd, {
    site: 'gene',
    name: 'lookup',
    description: 'test lookup',
    database: 'gene',
    args: [
      { name: 'gene', positional: true, required: true, help: 'Gene symbol' },
    ],
    columns: ['gene'],
  } as never);
  return program;
}

describe('registerCommandToProgram batch cache integration', () => {
  beforeEach(() => {
    suiteHome = mkdtempSync(join(tmpdir(), 'biocli-commander-home-'));
    process.env.HOME = suiteHome;
    cleanupCache();
    executeCommandMock.mockReset();
    renderMock.mockReset();
    process.exitCode = undefined;
  });

  afterEach(() => {
    cleanupCache();
    if (suiteHome) {
      rmSync(suiteHome, { recursive: true, force: true });
      suiteHome = '';
    }
    restoreHome();
  });

  afterAll(() => {
    restoreHome();
    cleanupCache();
  });

  it('writes batch cache metadata and reuses cached items on a later skip-cached run', async () => {
    executeCommandMock.mockImplementation(async (_cmd, kwargs: Record<string, unknown>) => ({
      gene: kwargs.gene,
      source: 'live',
    }));

    const program = makeProgram();
    const warmOutdir = mkdtempSync(join(tmpdir(), 'biocli-commander-batch-'));
    const hitOutdir = mkdtempSync(join(tmpdir(), 'biocli-commander-batch-hit-'));
    try {
      await program.parseAsync([
        'node',
        'test',
        'gene',
        'lookup',
        'TP53,BRCA1',
        '--outdir',
        warmOutdir,
        '--format',
        'json',
      ]);

      expect(executeCommandMock).toHaveBeenCalledTimes(2);
      const firstManifest = JSON.parse(readFileSync(join(warmOutdir, 'manifest.json'), 'utf-8'));
      expect(firstManifest.cache).toMatchObject({
        policy: 'default',
        hits: 0,
        misses: 2,
        writes: 2,
      });
      expect(existsSync(join(warmOutdir, 'results.jsonl'))).toBe(true);

      executeCommandMock.mockImplementation(async () => {
        throw new Error('skip-cached run should not invoke executeCommand');
      });

      const secondProgram = makeProgram();
      await secondProgram.parseAsync([
        'node',
        'test',
        'gene',
        'lookup',
        'TP53,BRCA1',
        '--outdir',
        hitOutdir,
        '--skip-cached',
        '--format',
        'json',
      ]);

      const secondManifest = JSON.parse(readFileSync(join(hitOutdir, 'manifest.json'), 'utf-8'));
      const cachedRows = readFileSync(join(hitOutdir, 'results.jsonl'), 'utf-8')
        .trim()
        .split('\n')
        .map(line => JSON.parse(line));

      expect(secondManifest.cache).toMatchObject({
        policy: 'skip-cached',
        hits: 2,
        misses: 0,
        writes: 0,
      });
      expect(cachedRows).toHaveLength(2);
      expect(cachedRows[0]?.cache).toMatchObject({
        hit: true,
        source: 'result-cache',
      });
    } finally {
      rmSync(warmOutdir, { recursive: true, force: true });
      rmSync(hitOutdir, { recursive: true, force: true });
    }
  });

  it('injects --input-file values into aggregate positional args before execution validation', async () => {
    const inputFile = join(mkdtempSync(join(tmpdir(), 'biocli-commander-input-')), 'genes.txt');
    writeFileSync(inputFile, 'EGFR\nALK\n');

    const program = new Command();
    const siteCmd = program.command('aggregate');
    registerCommandToProgram(siteCmd, {
      site: 'aggregate',
      name: 'drug-target',
      description: 'test aggregate batch',
      database: 'aggregate',
      args: [
        { name: 'gene', positional: true, required: true, help: 'Gene symbol' },
        { name: 'disease', help: 'Disease filter' },
      ],
      columns: ['gene'],
    } as never);

    executeCommandMock.mockResolvedValue([{ query: 'EGFR' }, { query: 'ALK' }]);

    try {
      await program.parseAsync([
        'node',
        'test',
        'aggregate',
        'drug-target',
        '--input-file',
        inputFile,
        '--disease',
        'lung',
        '--format',
        'json',
      ]);

      expect(executeCommandMock).toHaveBeenCalledTimes(1);
      expect(executeCommandMock.mock.calls[0]?.[1]).toMatchObject({
        gene: 'EGFR,ALK',
        disease: 'lung',
      });
    } finally {
      rmSync(dirname(inputFile), { recursive: true, force: true });
    }
  });
});
