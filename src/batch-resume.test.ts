import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { createBatchArtifactSession } from './batch-resume.js';

describe('createBatchArtifactSession', () => {
  it('skips previously successful items on resume and rewrites final artifacts', () => {
    const outdir = mkdtempSync(join(tmpdir(), 'biocli-batch-resume-'));
    try {
      const first = createBatchArtifactSession({ outdir, resume: false });
      first.recordSuccess({
        input: 'TP53',
        index: 0,
        attempts: 1,
        succeededAt: '2026-04-13T00:00:01.000Z',
        result: {
          biocliVersion: '0.5.0',
          query: 'TP53',
          organism: 'human',
          completeness: 'complete',
          queriedAt: '2026-04-13T00:00:01.000Z',
          sources: ['NCBI Gene'],
          warnings: [],
          ids: { ncbiGeneId: '7157' },
          provenance: { retrievedAt: '2026-04-13T00:00:01.000Z', sources: [{ source: 'NCBI Gene' }] },
          data: { symbol: 'TP53', name: 'tumor protein p53', pathways: [], goTerms: [], interactions: [], diseases: [] },
        },
      });
      first.recordFailure({
        input: 'BRCA1',
        index: 1,
        command: 'aggregate/gene-profile',
        errorCode: 'EMPTY_RESULT',
        message: 'no data',
        retryable: false,
        attempts: 1,
        timestamp: '2026-04-13T00:00:02.000Z',
      });
      first.finalize({
        command: 'aggregate/gene-profile',
        totalItems: 2,
        startedAt: '2026-04-13T00:00:00.000Z',
        finishedAt: '2026-04-13T00:00:02.000Z',
      });

      const resumed = createBatchArtifactSession({ outdir, resume: true });
      expect(resumed.pendingItems(['TP53', 'BRCA1'])).toEqual(['BRCA1']);
      resumed.recordSuccess({
        input: 'BRCA1',
        index: 1,
        attempts: 1,
        succeededAt: '2026-04-13T00:00:03.000Z',
        result: {
          biocliVersion: '0.5.0',
          query: 'BRCA1',
          organism: 'human',
          completeness: 'complete',
          queriedAt: '2026-04-13T00:00:03.000Z',
          sources: ['NCBI Gene'],
          warnings: [],
          ids: { ncbiGeneId: '672' },
          provenance: { retrievedAt: '2026-04-13T00:00:03.000Z', sources: [{ source: 'NCBI Gene' }] },
          data: { symbol: 'BRCA1', name: 'BRCA1 DNA repair associated', pathways: [], goTerms: [], interactions: [], diseases: [] },
        },
      });

      const finalized = resumed.finalize({
        command: 'aggregate/gene-profile',
        totalItems: 2,
        startedAt: '2026-04-13T00:00:02.500Z',
        finishedAt: '2026-04-13T00:00:03.500Z',
      });

      expect(finalized.successes).toHaveLength(2);
      expect(finalized.failures).toHaveLength(0);
      expect(finalized.manifest.resume).toMatchObject({
        resumed: true,
        skippedCompleted: 1,
        previousSucceeded: 1,
        previousFailed: 1,
      });

      const failuresJsonl = readFileSync(join(outdir, 'failures.jsonl'), 'utf-8').trim();
      expect(failuresJsonl).toBe('');
      const resultsJsonl = readFileSync(join(outdir, 'results.jsonl'), 'utf-8').trim().split('\n');
      expect(resultsJsonl).toHaveLength(2);
    } finally {
      rmSync(outdir, { recursive: true, force: true });
    }
  });

  it('tracks duplicate inputs by index so resume does not collapse repeated items', () => {
    const outdir = mkdtempSync(join(tmpdir(), 'biocli-batch-resume-dup-'));
    try {
      const first = createBatchArtifactSession({ outdir, resume: false });
      first.recordSuccess({
        input: 'EGFR',
        index: 0,
        attempts: 1,
        succeededAt: '2026-04-13T00:10:00.000Z',
        result: { query: 'EGFR #1' },
      });
      first.finalize({
        command: 'aggregate/drug-target',
        totalItems: 2,
        startedAt: '2026-04-13T00:09:00.000Z',
        finishedAt: '2026-04-13T00:10:00.000Z',
      });

      const resumed = createBatchArtifactSession<{ query: string }>({ outdir, resume: true });
      expect(resumed.pendingItems(['EGFR', 'EGFR'])).toEqual(['EGFR']);
      expect(resumed.pendingEntries([
        { input: 'EGFR', index: 0 },
        { input: 'EGFR', index: 1 },
      ])).toEqual([{ input: 'EGFR', index: 1 }]);

      resumed.recordSuccess({
        input: 'EGFR',
        index: 1,
        attempts: 1,
        succeededAt: '2026-04-13T00:11:00.000Z',
        result: { query: 'EGFR #2' },
      });

      const finalized = resumed.finalize({
        command: 'aggregate/drug-target',
        totalItems: 2,
        startedAt: '2026-04-13T00:10:30.000Z',
        finishedAt: '2026-04-13T00:11:30.000Z',
      });

      expect(finalized.successes).toHaveLength(2);
      expect(finalized.successes[0]?.result).toEqual({ query: 'EGFR #1' });
      expect(finalized.successes[1]?.result).toEqual({ query: 'EGFR #2' });
    } finally {
      rmSync(outdir, { recursive: true, force: true });
    }
  });

  it('can resume from a manifest path without an explicit outdir', () => {
    const outdir = mkdtempSync(join(tmpdir(), 'biocli-batch-resume-manifest-'));
    try {
      const first = createBatchArtifactSession<{ query: string }>({ outdir, resume: false });
      first.recordSuccess({
        input: 'TP53',
        index: 0,
        attempts: 1,
        succeededAt: '2026-04-13T00:20:00.000Z',
        result: { query: 'TP53' },
      });
      first.recordFailure({
        input: 'BRCA1',
        index: 1,
        command: 'aggregate/gene-profile',
        errorCode: 'EMPTY_RESULT',
        message: 'missing',
        retryable: false,
        attempts: 1,
        timestamp: '2026-04-13T00:20:01.000Z',
      });
      first.finalize({
        command: 'aggregate/gene-profile',
        totalItems: 2,
        startedAt: '2026-04-13T00:19:00.000Z',
        finishedAt: '2026-04-13T00:20:01.000Z',
        inputSource: 'inline',
      });

      const resumed = createBatchArtifactSession<{ query: string }>({
        resume: true,
        resumeFrom: join(outdir, 'manifest.json'),
        command: 'aggregate/gene-profile',
      });
      expect(resumed.outdir).toBe(outdir);
      expect(resumed.resumeSource).toBe(join(outdir, 'manifest.json'));
      expect(resumed.previousManifest?.command).toBe('aggregate/gene-profile');
      expect(resumed.pendingItems(['TP53', 'BRCA1'])).toEqual(['BRCA1']);
    } finally {
      rmSync(outdir, { recursive: true, force: true });
    }
  });
});
