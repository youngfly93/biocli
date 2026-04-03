import { describe, expect, it, vi, beforeEach } from 'vitest';
import { getRegistry } from '../../registry.js';
import type { HttpContext } from '../../types.js';

// Mock the enrichr database functions before importing the command
const { submitGeneListMock, getEnrichmentMock } = vi.hoisted(() => ({
  submitGeneListMock: vi.fn(),
  getEnrichmentMock: vi.fn(),
}));

vi.mock('../../databases/enrichr.js', async (importOriginal) => {
  const actual = await importOriginal() as Record<string, unknown>;
  return {
    ...actual,
    submitGeneList: submitGeneListMock,
    getEnrichment: getEnrichmentMock,
  };
});

// Import after mocking
import './analyze.js';

const ENRICHMENT_RESULTS = [
  { rank: 1, term: 'p53 signaling pathway', pValue: 0.0001, zScore: -2.5, combinedScore: 150.3, genes: 'TP53;CDKN1A;BAX', adjustedPValue: 0.001 },
  { rank: 2, term: 'Apoptosis', pValue: 0.001, zScore: -2.0, combinedScore: 80.1, genes: 'TP53;BAX', adjustedPValue: 0.005 },
];

function makeCtx(): HttpContext {
  return {
    databaseId: 'enrichr',
    fetch: async () => { throw new Error('unexpected'); },
    fetchXml: async () => { throw new Error('unexpected'); },
    fetchText: async () => { throw new Error('unexpected'); },
    fetchJson: async () => { throw new Error('unexpected'); },
  };
}

describe('enrichr/analyze adapter', () => {
  beforeEach(() => {
    submitGeneListMock.mockReset();
    getEnrichmentMock.mockReset();
    submitGeneListMock.mockResolvedValue(12345);
    getEnrichmentMock.mockResolvedValue(ENRICHMENT_RESULTS);
  });

  it('submits gene list and retrieves enrichment results', async () => {
    const cmd = getRegistry().get('enrichr/analyze');
    expect(cmd?.func).toBeTypeOf('function');

    const result = await cmd!.func!(makeCtx(), {
      genes: 'TP53,BRCA1,CDKN1A,BAX,MDM2',
      library: 'KEGG_2021_Human',
      limit: 20,
    });
    const rows = Array.isArray(result) ? result : (result as any).rows;

    expect(submitGeneListMock).toHaveBeenCalledWith(['TP53', 'BRCA1', 'CDKN1A', 'BAX', 'MDM2']);
    expect(getEnrichmentMock).toHaveBeenCalledWith(12345, 'KEGG_2021_Human');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual(expect.objectContaining({
      rank: 1,
      term: 'p53 signaling pathway',
    }));
  });
});
