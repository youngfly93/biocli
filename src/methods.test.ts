import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  formatMethodsMarkdown,
  formatMethodsText,
  renderMethods,
  summarizeMethodsInput,
} from './methods.js';
import { wrapResult } from './types.js';
import { getVersion } from './version.js';

describe('methods', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-10T12:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('summarizes a BiocliResult envelope with provenance', () => {
    const payload = wrapResult(
      { symbol: 'TP53' },
      {
        ids: { ncbiGeneId: '7157', uniprotAccession: 'P04637' },
        sources: ['NCBI Gene', 'UniProt'],
        warnings: [],
        organism: 'Homo sapiens',
        query: 'TP53',
      },
    );

    expect(summarizeMethodsInput(payload)).toEqual({
      biocliVersion: getVersion(),
      query: 'TP53',
      organism: 'Homo sapiens',
      retrievedAt: '2026-04-10T12:00:00.000Z',
      completeness: 'complete',
      warningsCount: 0,
      sources: [
        {
          source: 'NCBI Gene',
          url: 'https://www.ncbi.nlm.nih.gov/gene/7157',
          apiVersion: 'E-utilities',
          recordIds: ['7157'],
        },
        {
          source: 'UniProt',
          url: 'https://www.uniprot.org/uniprotkb/P04637',
          apiVersion: 'REST',
          recordIds: ['P04637'],
        },
      ],
    });
  });

  it('reconstructs provenance for legacy-style result JSON without provenance field', () => {
    const legacy = {
      biocliVersion: '0.4.1',
      query: 'rs334',
      queriedAt: '2026-04-10T12:00:00.000Z',
      sources: ['dbSNP', 'ClinVar'],
      warnings: ['ClinVar returned a reduced field set'],
      ids: { rsId: 'rs334', clinvarAccession: 'VCV000012345' },
    };

    const summary = summarizeMethodsInput(legacy);
    expect(summary.completeness).toBe('partial');
    expect(summary.sources).toEqual([
      {
        source: 'dbSNP',
        url: 'https://www.ncbi.nlm.nih.gov/snp/rs334',
        apiVersion: 'E-utilities',
        recordIds: ['rs334'],
      },
      {
        source: 'ClinVar',
        url: 'https://www.ncbi.nlm.nih.gov/clinvar/',
        apiVersion: 'E-utilities',
        recordIds: ['VCV000012345'],
      },
    ]);
  });

  it('renders methods text and markdown for workflow manifests', () => {
    const manifest = {
      biocliVersion: '0.4.1',
      createdAt: '2026-04-10T12:00:00.000Z',
      dataset: 'GSE99999',
      organism: 'Homo sapiens',
      sources: ['GEO', 'NCBI Gene'],
      warnings: [],
      completeness: 'complete',
      provenance: {
        retrievedAt: '2026-04-10T12:00:00.000Z',
        sources: [
          { source: 'GEO', apiVersion: 'E-utilities', recordIds: ['GSE99999'], url: 'https://www.ncbi.nlm.nih.gov/geo/query/acc.cgi?acc=GSE99999' },
          { source: 'NCBI Gene', apiVersion: 'E-utilities', recordIds: ['7157'], url: 'https://www.ncbi.nlm.nih.gov/gene/7157' },
        ],
      },
    };

    expect(formatMethodsText(summarizeMethodsInput(manifest))).toContain('biocli v0.4.1 was used');
    expect(renderMethods(manifest, 'md')).toContain('## Sources');
    expect(formatMethodsMarkdown(summarizeMethodsInput(manifest))).toContain('GEO (record GSE99999; API E-utilities; URL https://www.ncbi.nlm.nih.gov/geo/query/acc.cgi?acc=GSE99999)');
  });
});
