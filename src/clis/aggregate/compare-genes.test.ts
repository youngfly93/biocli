import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FetchOptions, HttpContext } from '../../types.js';
import { getRegistry } from '../../registry.js';

const {
  createHttpContextForDatabaseMock,
  submitGeneListMock,
  getEnrichmentMock,
} = vi.hoisted(() => ({
  createHttpContextForDatabaseMock: vi.fn(),
  submitGeneListMock: vi.fn(),
  getEnrichmentMock: vi.fn(),
}));

vi.mock('../../databases/index.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../databases/index.js')>();
  return {
    ...actual,
    createHttpContextForDatabase: createHttpContextForDatabaseMock,
  };
});

vi.mock('../../databases/enrichr.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../databases/enrichr.js')>();
  return {
    ...actual,
    submitGeneList: submitGeneListMock,
    getEnrichment: getEnrichmentMock,
  };
});

import '../../clis/aggregate/compare-genes.js';

function unexpected(name: string) {
  return async () => {
    throw new Error(`Unexpected call to ${name}`);
  };
}

function buildNcbiContext(): HttpContext {
  return {
    databaseId: 'ncbi',
    fetch: unexpected('ncbi.fetch'),
    fetchText: unexpected('ncbi.fetchText'),
    fetchXml: unexpected('ncbi.fetchXml'),
    fetchJson: async (url: string) => {
      if (url.includes('esearch.fcgi') && url.includes('TP53')) {
        return { esearchresult: { idlist: ['7157'] } };
      }
      if (url.includes('esearch.fcgi') && url.includes('EGFR')) {
        return { esearchresult: { idlist: ['1956'] } };
      }
      if (url.includes('esearch.fcgi') && url.includes('BRCA1')) {
        return { esearchresult: { idlist: ['672'] } };
      }
      if (url.includes('esummary.fcgi') && url.includes('7157')) {
        return {
          result: {
            uids: ['7157'],
            '7157': {
              uid: '7157',
              name: 'TP53',
              description: 'tumor protein p53',
              organism: { scientificname: 'Homo sapiens' },
              chromosome: '17',
              maplocation: '17p13.1',
            },
          },
        };
      }
      if (url.includes('esummary.fcgi') && url.includes('1956')) {
        return {
          result: {
            uids: ['1956'],
            '1956': {
              uid: '1956',
              name: 'EGFR',
              description: 'epidermal growth factor receptor',
              organism: { scientificname: 'Homo sapiens' },
              chromosome: '7',
              maplocation: '7p11.2',
            },
          },
        };
      }
      if (url.includes('esummary.fcgi') && url.includes('672')) {
        return {
          result: {
            uids: ['672'],
            '672': {
              uid: '672',
              name: 'BRCA1',
              description: 'BRCA1 DNA repair associated',
              organism: { scientificname: 'Homo sapiens' },
              chromosome: '17',
              maplocation: '17q21.31',
            },
          },
        };
      }
      throw new Error(`Unhandled NCBI URL: ${url}`);
    },
  };
}

function buildUniprotContext(): HttpContext {
  return {
    databaseId: 'uniprot',
    fetch: unexpected('uniprot.fetch'),
    fetchText: unexpected('uniprot.fetchText'),
    fetchXml: unexpected('uniprot.fetchXml'),
    fetchJson: async (url: string) => {
      if (url.includes('gene%3ATP53')) {
        return {
          results: [{
            primaryAccession: 'P04637',
            genes: [{ geneName: { value: 'TP53' } }],
            comments: [{ commentType: 'FUNCTION', texts: [{ value: 'DNA damage checkpoint regulator.' }] }],
            uniProtKBCrossReferences: [
              { database: 'GO', id: 'GO:0006977', properties: [{ key: 'GoTerm', value: 'P:DNA damage response' }] },
              { database: 'GO', id: 'GO:0005634', properties: [{ key: 'GoTerm', value: 'C:Nucleus' }] },
            ],
          }],
        };
      }
      if (url.includes('gene%3AEGFR')) {
        return {
          results: [{
            primaryAccession: 'P00533',
            genes: [{ geneName: { value: 'EGFR' } }],
            comments: [{ commentType: 'FUNCTION', texts: [{ value: 'Receptor tyrosine kinase.' }] }],
            uniProtKBCrossReferences: [
              { database: 'GO', id: 'GO:0007173', properties: [{ key: 'GoTerm', value: 'P:Epidermal growth factor receptor signaling pathway' }] },
              { database: 'GO', id: 'GO:0005887', properties: [{ key: 'GoTerm', value: 'C:Integral component of plasma membrane' }] },
            ],
          }],
        };
      }
      if (url.includes('gene%3ABRCA1')) {
        return {
          results: [{
            primaryAccession: 'P38398',
            genes: [{ geneName: { value: 'BRCA1' } }],
            comments: [{ commentType: 'FUNCTION', texts: [{ value: 'DNA repair scaffold.' }] }],
            uniProtKBCrossReferences: [
              { database: 'GO', id: 'GO:0006281', properties: [{ key: 'GoTerm', value: 'P:DNA repair' }] },
              { database: 'GO', id: 'GO:0005634', properties: [{ key: 'GoTerm', value: 'C:Nucleus' }] },
            ],
          }],
        };
      }
      throw new Error(`Unhandled UniProt URL: ${url}`);
    },
  };
}

function buildKeggContext(): HttpContext {
  return {
    databaseId: 'kegg',
    fetch: unexpected('kegg.fetch'),
    fetchJson: unexpected('kegg.fetchJson'),
    fetchXml: unexpected('kegg.fetchXml'),
    fetchText: async (url: string, _opts?: FetchOptions) => {
      if (url.endsWith('/link/pathway/hsa:7157')) {
        return 'hsa:7157\tpath:hsa04115\nhsa:7157\tpath:hsa05200\n';
      }
      if (url.endsWith('/link/pathway/hsa:1956')) {
        return 'hsa:1956\tpath:hsa04012\nhsa:1956\tpath:hsa05200\n';
      }
      if (url.endsWith('/link/pathway/hsa:672')) {
        return 'hsa:672\tpath:hsa03440\nhsa:672\tpath:hsa05200\n';
      }
      if (url.endsWith('/list/pathway/hsa')) {
        return [
          'path:hsa04115\tp53 signaling pathway - Homo sapiens (human)',
          'path:hsa04012\tErbB signaling pathway - Homo sapiens (human)',
          'path:hsa03440\tHomologous recombination - Homo sapiens (human)',
          'path:hsa05200\tPathways in cancer - Homo sapiens (human)',
          '',
        ].join('\n');
      }
      throw new Error(`Unhandled KEGG URL: ${url}`);
    },
  };
}

function buildStringContext(): HttpContext {
  return {
    databaseId: 'string',
    fetch: unexpected('string.fetch'),
    fetchText: unexpected('string.fetchText'),
    fetchXml: unexpected('string.fetchXml'),
    fetchJson: async (url: string) => {
      if (!url.includes('/network')) throw new Error(`Unhandled STRING URL: ${url}`);
      return [
        {
          preferredName_A: 'TP53',
          preferredName_B: 'EGFR',
          score: 0.91,
          escore: 0.31,
          dscore: 0.28,
          tscore: 0.22,
        },
        {
          preferredName_A: 'TP53',
          preferredName_B: 'BRCA1',
          score: 0.82,
          escore: 0.27,
          dscore: 0.26,
          tscore: 0.18,
        },
      ];
    },
  };
}

describe('aggregate/compare-genes', () => {
  beforeEach(() => {
    createHttpContextForDatabaseMock.mockReset();
    submitGeneListMock.mockReset();
    getEnrichmentMock.mockReset();

    createHttpContextForDatabaseMock.mockImplementation((databaseId: string) => {
      if (databaseId === 'ncbi') return buildNcbiContext();
      if (databaseId === 'uniprot') return buildUniprotContext();
      if (databaseId === 'kegg') return buildKeggContext();
      if (databaseId === 'string') return buildStringContext();
      throw new Error(`Unexpected database context request: ${databaseId}`);
    });

    submitGeneListMock.mockResolvedValue(123);
    getEnrichmentMock.mockResolvedValue([
      {
        rank: 1,
        term: 'response to DNA damage stimulus',
        adjustedPValue: 1e-6,
        combinedScore: 42.5,
        genes: 'TP53,BRCA1',
      },
      {
        rank: 2,
        term: 'epidermal growth factor receptor signaling pathway',
        adjustedPValue: 1e-4,
        combinedScore: 35.2,
        genes: 'EGFR',
      },
    ]);
  });

  it('builds a structured cross-gene comparison report', async () => {
    const command = getRegistry().get('aggregate/compare-genes');
    expect(command?.func).toBeTypeOf('function');

    const result = await command!.func!(
      {} as HttpContext,
      { genes: 'TP53,EGFR,BRCA1', organism: 'human', limit: 10, library: 'GO_Biological_Process_2023', minShared: 2 },
    ) as Record<string, unknown>;

    expect(result.sources).toEqual(['NCBI Gene', 'UniProt', 'KEGG', 'STRING', 'Enrichr']);
    expect(result.warnings).toEqual([]);
    expect(result.organism).toBe('Homo sapiens');

    const data = result.data as Record<string, unknown>;
    expect(data.summary).toMatchObject({
      geneCount: 3,
      sharedPathwayCount: 1,
      sharedGoTermCount: 1,
      interactionCount: 2,
      pairwiseComparisons: 3,
      goEnrichmentTerms: 2,
    });

    const sharedPathways = data.sharedPathways as Array<Record<string, unknown>>;
    expect(sharedPathways[0]).toMatchObject({
      id: 'hsa05200',
      name: 'Pathways in cancer',
      geneCount: 3,
      genes: ['BRCA1', 'EGFR', 'TP53'],
    });

    const sharedGoTerms = data.sharedGoTerms as Array<Record<string, unknown>>;
    expect(sharedGoTerms[0]).toMatchObject({
      id: 'GO:0005634',
      name: 'Nucleus',
      aspect: 'CC',
      geneCount: 2,
    });

    const pairwise = data.pairwiseOverlap as Array<Record<string, unknown>>;
    expect(pairwise).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          geneA: 'TP53',
          geneB: 'BRCA1',
          sharedPathwayCount: 1,
          sharedGoTermCount: 1,
        }),
        expect.objectContaining({
          geneA: 'TP53',
          geneB: 'EGFR',
          interactionScore: 0.91,
        }),
      ]),
    );

    const specificPathways = data.geneSpecificPathways as Array<Record<string, unknown>>;
    expect(specificPathways).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          gene: 'EGFR',
          pathways: expect.arrayContaining([
            expect.objectContaining({ pathwayId: 'hsa04012', pathwayName: 'ErbB signaling pathway' }),
          ]),
        }),
      ]),
    );

    const goEnrichment = data.goEnrichment as Array<Record<string, unknown>>;
    expect(goEnrichment[0]).toMatchObject({
      rank: 1,
      term: 'response to DNA damage stimulus',
      source: 'Enrichr',
    });
  });
});
