import { describe, expect, it, vi, beforeEach } from 'vitest';
import { getRegistry } from '../../registry.js';

const { createHttpContextForDatabaseMock } = vi.hoisted(() => ({
  createHttpContextForDatabaseMock: vi.fn(),
}));

vi.mock('../../databases/index.js', async (importOriginal) => {
  const actual = await importOriginal() as Record<string, unknown>;
  return {
    ...actual,
    createHttpContextForDatabase: createHttpContextForDatabaseMock,
  };
});

import './workflow-scout.js';

function buildNcbiContext() {
  return {
    databaseId: 'ncbi',
    fetch: async () => { throw new Error('unexpected'); },
    fetchXml: async () => { throw new Error('unexpected'); },
    fetchText: async () => { throw new Error('unexpected'); },
    fetchJson: async (url: string) => {
      // GEO esearch
      if (url.includes('esearch.fcgi') && url.includes('db=gds')) {
        return { esearchresult: { idlist: ['200100550'], count: '1' } };
      }
      // GEO esummary
      if (url.includes('esummary.fcgi') && url.includes('db=gds')) {
        return {
          result: {
            uids: ['200100550'],
            '200100550': {
              accession: 'GSE100550',
              title: 'TP53 breast cancer RNA-seq study',
              taxon: 'Homo sapiens',
              entrytype: 'GSE',
              n_samples: 48,
              pdat: '2023/06/15',
            },
          },
        };
      }
      // SRA esearch
      if (url.includes('esearch.fcgi') && url.includes('db=sra')) {
        return { esearchresult: { idlist: ['12345'], count: '1' } };
      }
      // SRA esummary
      if (url.includes('esummary.fcgi') && url.includes('db=sra')) {
        return {
          result: {
            uids: ['12345'],
            '12345': {
              expxml: '<Summary><Title>TP53 knockdown RNA-seq</Title><Organism taxname="Homo sapiens"/></Summary>',
              runs: '<Run acc="SRR12345678"/>',
              total_runs: '1',
              createdate: '2023/04/01',
            },
          },
        };
      }
      throw new Error(`Unexpected fetchJson: ${url}`);
    },
  };
}

describe('aggregate/workflow-scout', () => {
  beforeEach(() => {
    createHttpContextForDatabaseMock.mockReset();
    createHttpContextForDatabaseMock.mockImplementation(() => buildNcbiContext());
  });

  it('returns GEO and SRA candidates', async () => {
    const cmd = getRegistry().get('aggregate/workflow-scout');
    expect(cmd?.func).toBeTypeOf('function');

    const result = await cmd!.func!({} as any, {
      query: 'TP53 breast cancer RNA-seq',
      gene: 'TP53',
      organism: 'Homo sapiens',
      limit: 5,
      type: 'gse',
    }) as Record<string, unknown>;

    expect(result.sources).toContain('GEO');
    expect(result.sources).toContain('SRA');

    const data = result.data as Record<string, unknown>;
    const candidates = data.candidates as Record<string, unknown>[];
    expect(candidates.length).toBeGreaterThanOrEqual(2);
    expect(candidates.find((c: any) => c.source === 'GEO')).toBeDefined();
    expect(candidates.find((c: any) => c.source === 'SRA')).toBeDefined();

    const nextSteps = data.nextSteps as string[];
    expect(nextSteps.length).toBeGreaterThan(0);
  });
});
