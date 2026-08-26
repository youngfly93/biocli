import { describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { runBatchExecution } from './batch-execution.js';
import { EXIT_CODES } from './errors.js';

function tempOutdir(label: string): string {
  return mkdtempSync(join(tmpdir(), `biocli-${label}-`));
}

describe('batch coverage gating', () => {
  it('--strict fails on a hard failure even when nothing is degraded', async () => {
    const outdir = tempOutdir('strict-hard-failure');
    try {
      await expect(runBatchExecution<unknown>({
        command: 'aggregate/gene-profile',
        items: ['GOOD', 'BAD'],
        concurrency: 1,
        strict: true,
        outdir,
        executor: async (item) => {
          if (item === 'BAD') throw new Error('terminal failure');
          return { query: item, completeness: 'complete' };
        },
      })).rejects.toMatchObject({
        code: 'INCOMPLETE_DATA',
        exitCode: EXIT_CODES.INCOMPLETE_DATA,
      });
    } finally {
      rmSync(outdir, { recursive: true, force: true });
    }
  });

  it('--strict fails on degraded data even when nothing hard-failed', async () => {
    const outdir = tempOutdir('strict-degraded');
    try {
      await expect(runBatchExecution<unknown>({
        command: 'aggregate/gene-profile',
        items: ['A'],
        concurrency: 1,
        strict: true,
        outdir,
        executor: async () => ({ query: 'A', completeness: 'degraded' }),
      })).rejects.toMatchObject({ code: 'INCOMPLETE_DATA' });
    } finally {
      rmSync(outdir, { recursive: true, force: true });
    }
  });

  it('--strict passes when every item is complete', async () => {
    const outdir = tempOutdir('strict-clean');
    try {
      const result = await runBatchExecution<unknown>({
        command: 'aggregate/gene-profile',
        items: ['A', 'B'],
        concurrency: 1,
        strict: true,
        outdir,
        executor: async (item) => ({ query: item, completeness: 'complete' }),
      });
      expect(result.successes).toHaveLength(2);
      expect(result.degradedInputs).toEqual([]);
    } finally {
      rmSync(outdir, { recursive: true, force: true });
    }
  });

  it('keeps a failed recovery attempt auditable without losing the retained result', async () => {
    const outdir = tempOutdir('retry-failure-audit');
    try {
      await runBatchExecution<unknown>({
        command: 'aggregate/gene-profile',
        items: ['A'],
        concurrency: 1,
        outdir,
        executor: async () => ({ query: 'A', completeness: 'partial' }),
      });

      await runBatchExecution<unknown>({
        command: 'aggregate/gene-profile',
        items: ['A'],
        concurrency: 1,
        outdir,
        retryDegraded: true,
        executor: async () => { throw new Error('retry blew up'); },
      });

      const failures = readFileSync(join(outdir, 'failures.jsonl'), 'utf-8').trim();
      expect(failures).not.toBe('');
      expect(JSON.parse(failures).input).toBe('A');
      expect(failures).toContain('retry blew up');

      // The earlier partial result is still there, so the item is not counted
      // as one left without data.
      const results = readFileSync(join(outdir, 'results.jsonl'), 'utf-8').trim();
      expect(JSON.parse(results).result).toMatchObject({ completeness: 'partial' });

      const summary = JSON.parse(readFileSync(join(outdir, 'summary.json'), 'utf-8'));
      expect(summary.succeeded).toBe(1);
      expect(summary.failed).toBe(0);
      expect(summary.degraded).toBe(1);

      expect(readFileSync(join(outdir, 'methods.md'), 'utf-8')).toContain('- Failures: 0');
    } finally {
      rmSync(outdir, { recursive: true, force: true });
    }
  });
});
