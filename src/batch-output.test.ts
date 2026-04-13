import { describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { writeBatchArtifacts } from './batch-output.js';

describe('writeBatchArtifacts', () => {
  it('writes manifest, summary, and jsonl artifact files', () => {
    const outdir = mkdtempSync(join(tmpdir(), 'biocli-batch-output-'));
    try {
      const manifest = writeBatchArtifacts({
        outdir,
        command: 'aggregate/gene-profile',
        summary: {
          command: 'aggregate/gene-profile',
          totalItems: 2,
          succeeded: 1,
          failed: 1,
          startedAt: '2026-04-12T00:00:00.000Z',
          finishedAt: '2026-04-12T00:00:02.000Z',
          durationSeconds: 2,
        },
        inputSource: 'genes.txt',
        inputFormat: 'text',
        concurrency: 4,
        retries: 1,
        resume: {
          resumed: true,
          source: '/tmp/previous-run/manifest.json',
          skippedCompleted: 1,
          previousSucceeded: 1,
          previousFailed: 1,
        },
        cache: {
          policy: 'skip-cached',
          hits: 1,
          misses: 1,
          writes: 1,
        },
        snapshots: [{
          dataset: 'GDSC',
          source: 'local-dataset',
          path: '/tmp/gdsc',
          release: '8.5',
          fetchedAt: '2026-04-12T00:00:00.000Z',
          staleAfterDays: 90,
          refreshed: true,
        }],
        successes: [{
          input: 'TP53',
          index: 0,
          attempts: 0,
          succeededAt: '2026-04-12T00:00:01.000Z',
          cache: {
            hit: true,
            source: 'result-cache',
            cachedAt: '2026-04-11T23:59:00.000Z',
          },
          result: {
            biocliVersion: '0.5.0',
            query: 'TP53',
            organism: 'human',
            completeness: 'complete',
            queriedAt: '2026-04-12T00:00:01.000Z',
            sources: ['NCBI Gene'],
            warnings: [],
            ids: { ncbiGeneId: '7157' },
            data: {
              symbol: 'TP53',
              name: 'tumor protein p53',
              pathways: [{ id: 'hsa04115' }],
              goTerms: [{ id: 'GO:1' }],
              interactions: [],
              diseases: [],
            },
          },
        }],
        failures: [{
          input: 'BAD1',
          index: 1,
          command: 'aggregate/gene-profile',
          errorCode: 'EMPTY_RESULT',
          message: 'no data',
          retryable: false,
          attempts: 2,
          timestamp: '2026-04-12T00:00:02.000Z',
        }],
      });

      expect(existsSync(join(outdir, 'results.jsonl'))).toBe(true);
      expect(existsSync(join(outdir, 'failures.jsonl'))).toBe(true);
      expect(existsSync(join(outdir, 'summary.json'))).toBe(true);
      expect(existsSync(join(outdir, 'summary.csv'))).toBe(true);
      expect(existsSync(join(outdir, 'manifest.json'))).toBe(true);
      expect(existsSync(join(outdir, 'methods.md'))).toBe(true);
      expect(manifest.command).toBe('aggregate/gene-profile');

      const resultLine = readFileSync(join(outdir, 'results.jsonl'), 'utf-8').trim();
      const failureLine = readFileSync(join(outdir, 'failures.jsonl'), 'utf-8').trim();
      const summary = JSON.parse(readFileSync(join(outdir, 'summary.json'), 'utf-8'));
      const summaryCsv = readFileSync(join(outdir, 'summary.csv'), 'utf-8');
      const methodsMd = readFileSync(join(outdir, 'methods.md'), 'utf-8');
      const manifestJson = JSON.parse(readFileSync(join(outdir, 'manifest.json'), 'utf-8'));

      expect(JSON.parse(resultLine).input).toBe('TP53');
      expect(JSON.parse(failureLine).input).toBe('BAD1');
      expect(summary.succeeded).toBe(1);
      expect(summaryCsv).toContain('input,query,symbol');
      expect(methodsMd).toContain('## Methods Summary');
      expect(manifestJson.files.resultsJsonl).toBe('results.jsonl');
      expect(manifestJson.files.summaryCsv).toBe('summary.csv');
      expect(manifestJson.files.methodsMd).toBe('methods.md');
      expect(manifestJson.resume).toMatchObject({
        resumed: true,
        skippedCompleted: 1,
        previousSucceeded: 1,
        previousFailed: 1,
      });
      expect(manifestJson.cache).toMatchObject({
        policy: 'skip-cached',
        hits: 1,
        misses: 1,
        writes: 1,
      });
      expect(manifestJson.snapshots).toEqual([expect.objectContaining({
        dataset: 'GDSC',
        refreshed: true,
      })]);
    } finally {
      rmSync(outdir, { recursive: true, force: true });
    }
  });
});
