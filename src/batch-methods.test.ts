import { describe, expect, it } from 'vitest';
import { formatBatchMethodsMarkdown } from './batch-methods.js';

describe('formatBatchMethodsMarkdown', () => {
  it('summarizes batch successes and failures into markdown', () => {
    const markdown = formatBatchMethodsMarkdown({
      command: 'aggregate/gene-profile',
      inputCount: 2,
      startedAt: '2026-04-12T00:00:00.000Z',
      finishedAt: '2026-04-12T00:00:02.000Z',
      successes: [{
        input: 'TP53',
        index: 0,
        attempts: 1,
        succeededAt: '2026-04-12T00:00:01.000Z',
        result: {
          biocliVersion: '0.5.0',
          organism: 'human',
          warnings: ['STRING degraded'],
          sources: ['NCBI Gene', 'UniProt'],
          provenance: {
            retrievedAt: '2026-04-12T00:00:01.000Z',
            sources: [{ source: 'NCBI Gene' }, { source: 'UniProt' }],
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
        attempts: 1,
        timestamp: '2026-04-12T00:00:02.000Z',
      }],
    });

    expect(markdown).toContain('## Methods Summary');
    expect(markdown).toContain('aggregate/gene-profile batch (2 items)');
    expect(markdown).toContain('## Batch Run');
    expect(markdown).toContain('Failures: 1');
    expect(markdown).toContain('BAD1: EMPTY_RESULT');
  });
});
