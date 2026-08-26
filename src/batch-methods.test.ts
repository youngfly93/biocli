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

  function batchSuccess(input: string, index: number, completeness: string, sources: object[]) {
    return {
      input,
      index,
      attempts: 1,
      succeededAt: '2026-04-12T00:00:01.000Z',
      result: {
        biocliVersion: '0.7.1',
        organism: 'Homo sapiens',
        completeness,
        warnings: [],
        provenance: { retrievedAt: '2026-04-12T00:00:01.000Z', sources },
      },
    };
  }

  it('never carries one item\'s record identifiers onto the whole batch', () => {
    // EGFR contributed only UniProt; KRAS contributed NCBI Gene and KEGG.
    // Deduping by backend name alone used to fuse EGFR's P00533 with KRAS's
    // 3845 into a single provenance sentence for the batch.
    const markdown = formatBatchMethodsMarkdown({
      command: 'aggregate/gene-profile',
      inputCount: 2,
      startedAt: '2026-04-12T00:00:00.000Z',
      finishedAt: '2026-04-12T00:00:02.000Z',
      successes: [
        batchSuccess('EGFR', 0, 'partial', [
          { source: 'UniProt', apiVersion: 'REST', recordIds: ['P00533'], url: 'https://www.uniprot.org/uniprotkb/P00533' },
          { source: 'STRING', apiVersion: 'JSON API', url: 'https://string-db.org/api' },
        ]),
        batchSuccess('KRAS', 1, 'complete', [
          { source: 'UniProt', apiVersion: 'REST', recordIds: ['P01116'], url: 'https://www.uniprot.org/uniprotkb/P01116' },
          { source: 'STRING', apiVersion: 'JSON API', url: 'https://string-db.org/api' },
          { source: 'NCBI Gene', apiVersion: 'E-utilities', recordIds: ['3845'], url: 'https://www.ncbi.nlm.nih.gov/gene/3845' },
          { source: 'KEGG', apiVersion: 'REST', recordIds: ['hsa:3845'], url: 'https://www.kegg.jp/entry/hsa%3A3845' },
        ]),
      ],
      failures: [],
    });

    expect(markdown).not.toContain('P00533');
    expect(markdown).not.toContain('P01116');
    expect(markdown).not.toContain('3845');
    expect(markdown).not.toContain('record');

    // Backends are still named, and a URL identical across every item — a
    // stable API root rather than a per-record landing page — survives.
    expect(markdown).toContain('UniProt (API REST)');
    expect(markdown).toContain('NCBI Gene (API E-utilities)');
    expect(markdown).toContain('STRING (API JSON API; URL https://string-db.org/api)');
  });

  it('does not describe a batch with incomplete items as complete', () => {
    const markdown = formatBatchMethodsMarkdown({
      command: 'aggregate/gene-profile',
      inputCount: 2,
      startedAt: '2026-04-12T00:00:00.000Z',
      finishedAt: '2026-04-12T00:00:02.000Z',
      successes: [
        batchSuccess('EGFR', 0, 'partial', [{ source: 'UniProt' }]),
        batchSuccess('KRAS', 1, 'complete', [{ source: 'UniProt' }]),
      ],
      failures: [],
    });

    expect(markdown).toContain('classified as partial');
    expect(markdown).not.toContain('classified as complete');
    expect(markdown).toContain('- Complete: 1');
    expect(markdown).toContain('- Incomplete: 1 (1 partial, 0 degraded)');
    expect(markdown).toContain('## Incomplete Items');
    expect(markdown).toContain('- EGFR');
  });

  it('still reports complete when every item is complete', () => {
    const markdown = formatBatchMethodsMarkdown({
      command: 'aggregate/gene-profile',
      inputCount: 1,
      startedAt: '2026-04-12T00:00:00.000Z',
      finishedAt: '2026-04-12T00:00:02.000Z',
      successes: [batchSuccess('KRAS', 0, 'complete', [{ source: 'UniProt' }])],
      failures: [],
    });

    expect(markdown).toContain('classified as complete');
    expect(markdown).not.toContain('## Incomplete Items');
  });

});
