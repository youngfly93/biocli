import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildBiocliProvenance, deriveBiocliCompleteness, wrapResult } from './types.js';
import { getVersion } from './version.js';

describe('types', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-10T12:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('wrapResult builds structured provenance and completeness from source metadata', () => {
    const result = wrapResult(
      { symbol: 'TP53' },
      {
        ids: {
          ncbiGeneId: '7157',
          uniprotAccession: 'P04637',
        },
        sources: ['NCBI Gene', 'UniProt'],
        warnings: [],
        query: 'TP53',
      },
    );

    expect(result.queriedAt).toBe('2026-04-10T12:00:00.000Z');
    expect(result.biocliVersion).toBe(getVersion());
    expect(result.completeness).toBe('complete');
    expect(result.provenance).toEqual({
      retrievedAt: '2026-04-10T12:00:00.000Z',
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

  it('supports override-driven provenance and degraded completeness', () => {
    const result = wrapResult(
      { papers: [] },
      {
        sources: ['PubMed'],
        warnings: ['PubMed returned a partial result set'],
        query: 'TP53 immunotherapy',
        completeness: 'degraded',
        provenance: [{
          source: 'PubMed',
          recordIds: ['36766853', '40000000'],
          databaseRelease: 'baseline snapshot',
        }],
      },
    );

    expect(result.completeness).toBe('degraded');
    expect(result.provenance).toEqual({
      retrievedAt: '2026-04-10T12:00:00.000Z',
      sources: [
        {
          source: 'PubMed',
          url: 'https://pubmed.ncbi.nlm.nih.gov/',
          apiVersion: 'E-utilities',
          databaseRelease: 'baseline snapshot',
          recordIds: ['36766853', '40000000'],
        },
      ],
    });
  });

  it('buildBiocliProvenance deduplicates sources while preserving explicit overrides', () => {
    expect(buildBiocliProvenance({
      queriedAt: '2026-04-10T12:00:00.000Z',
      ids: { dataset: 'GSE12345' },
      sources: ['GEO', 'GEO'],
      provenance: [{ source: 'GEO', recordIds: ['GSE12345'] }],
    })).toEqual({
      retrievedAt: '2026-04-10T12:00:00.000Z',
      sources: [
        {
          source: 'GEO',
          url: 'https://www.ncbi.nlm.nih.gov/geo/query/acc.cgi?acc=GSE12345',
          apiVersion: 'E-utilities',
          recordIds: ['GSE12345'],
        },
      ],
    });
  });

  it('deriveBiocliCompleteness marks warning-only no-source results as degraded', () => {
    expect(deriveBiocliCompleteness([], ['fetch failed'])).toBe('degraded');
    expect(deriveBiocliCompleteness(['NCBI Gene'], ['fetch failed'])).toBe('partial');
    expect(deriveBiocliCompleteness(['NCBI Gene'], [])).toBe('complete');
  });
});
