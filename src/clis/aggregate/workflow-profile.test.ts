import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
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

import './workflow-profile.js';

function unexpected(name: string) {
  return async () => {
    throw new Error(`Unexpected call to ${name}`);
  };
}

function buildNcbiContext() {
  return {
    databaseId: 'ncbi',
    fetch: unexpected('ncbi.fetch'),
    fetchXml: unexpected('ncbi.fetchXml'),
    fetchText: unexpected('ncbi.fetchText'),
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
            '7157': { uid: '7157', name: 'TP53', description: 'tumor protein p53', chromosome: '17', maplocation: '17p13.1' },
          },
        };
      }
      if (url.includes('esummary.fcgi') && url.includes('1956')) {
        return {
          result: {
            uids: ['1956'],
            '1956': { uid: '1956', name: 'EGFR', description: 'epidermal growth factor receptor', chromosome: '7', maplocation: '7p11.2' },
          },
        };
      }
      if (url.includes('esummary.fcgi') && url.includes('672')) {
        return {
          result: {
            uids: ['672'],
            '672': { uid: '672', name: 'BRCA1', description: 'BRCA1 DNA repair associated', chromosome: '17', maplocation: '17q21.31' },
          },
        };
      }
      throw new Error(`Unhandled NCBI URL: ${url}`);
    },
  };
}

function buildUniprotContext() {
  return {
    databaseId: 'uniprot',
    fetch: unexpected('uniprot.fetch'),
    fetchXml: unexpected('uniprot.fetchXml'),
    fetchText: unexpected('uniprot.fetchText'),
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
              { database: 'GO', id: 'GO:0007173', properties: [{ key: 'GoTerm', value: 'P:EGFR signaling pathway' }] },
              { database: 'GO', id: 'GO:0005887', properties: [{ key: 'GoTerm', value: 'C:Membrane' }] },
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

function buildKeggContext() {
  return {
    databaseId: 'kegg',
    fetch: unexpected('kegg.fetch'),
    fetchXml: unexpected('kegg.fetchXml'),
    fetchJson: unexpected('kegg.fetchJson'),
    fetchText: async (url: string) => {
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

function buildStringContext() {
  return {
    databaseId: 'string',
    fetch: unexpected('string.fetch'),
    fetchXml: unexpected('string.fetchXml'),
    fetchText: unexpected('string.fetchText'),
    fetchJson: async () => ([
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
    ]),
  };
}

describe('aggregate/workflow-profile', () => {
  const tempDirs: string[] = [];

  beforeEach(() => {
    createHttpContextForDatabaseMock.mockReset();
    submitGeneListMock.mockReset();
    getEnrichmentMock.mockReset();

    createHttpContextForDatabaseMock.mockImplementation((databaseId: string) => {
      if (databaseId === 'ncbi') return buildNcbiContext();
      if (databaseId === 'uniprot') return buildUniprotContext();
      if (databaseId === 'kegg') return buildKeggContext();
      if (databaseId === 'string') return buildStringContext();
      throw new Error(`Unexpected database: ${databaseId}`);
    });

    submitGeneListMock.mockResolvedValue(999);
    getEnrichmentMock.mockResolvedValue([
      {
        term: 'Pathways in cancer',
        adjustedPValue: 5e-5,
        combinedScore: 41.2,
        genes: 'TP53,EGFR,BRCA1',
      },
    ]);
  });

  afterEach(() => {
    while (tempDirs.length > 0) {
      const dir = tempDirs.pop();
      if (dir) rmSync(dir, { recursive: true, force: true });
    }
  });

  function makeOutdir(name: string): string {
    const dir = mkdtempSync(resolve(tmpdir(), `biocli-workflow-profile-${name}-`));
    tempDirs.push(dir);
    return join(dir, 'out');
  }

  it('returns a plan without writing files', async () => {
    const cmd = getRegistry().get('aggregate/workflow-profile');
    expect(cmd?.func).toBeTypeOf('function');

    const outdir = makeOutdir('plan');
    const result = await cmd!.func!({} as never, {
      genes: 'TP53,EGFR,BRCA1',
      outdir,
      organism: 'human',
      library: 'KEGG_2021_Human',
      plan: true,
    }) as Record<string, unknown>;

    const data = result.data as Record<string, unknown>;
    expect(data.plan).toHaveLength(6);
    expect(result.sources).toEqual([]);
    expect(existsSync(outdir)).toBe(false);
  });

  it('rejects gene sets smaller than two genes', async () => {
    const cmd = getRegistry().get('aggregate/workflow-profile');
    expect(cmd?.func).toBeTypeOf('function');

    await expect(cmd!.func!({} as never, {
      genes: 'TP53',
      outdir: makeOutdir('bad'),
      organism: 'human',
      library: 'KEGG_2021_Human',
    })).rejects.toMatchObject({
      code: 'ARGUMENT',
      message: expect.stringContaining('At least 2 gene symbols required'),
    });
  });

  it('writes set-level profile outputs and report artifacts', async () => {
    const cmd = getRegistry().get('aggregate/workflow-profile');
    expect(cmd?.func).toBeTypeOf('function');

    const outdir = makeOutdir('run');
    const result = await cmd!.func!({} as never, {
      genes: 'TP53,EGFR,BRCA1',
      outdir,
      organism: 'human',
      library: 'KEGG_2021_Human',
    }) as Record<string, unknown>;

    expect(existsSync(join(outdir, 'profiles.json'))).toBe(true);
    expect(existsSync(join(outdir, 'interactions.csv'))).toBe(true);
    expect(existsSync(join(outdir, 'shared_pathways.csv'))).toBe(true);
    expect(existsSync(join(outdir, 'go_summary.csv'))).toBe(true);
    expect(existsSync(join(outdir, 'enrichment.csv'))).toBe(true);
    expect(existsSync(join(outdir, 'report.md'))).toBe(true);
    expect(existsSync(join(outdir, 'manifest.json'))).toBe(true);

    const profiles = JSON.parse(readFileSync(join(outdir, 'profiles.json'), 'utf-8'));
    expect(profiles).toHaveLength(3);
    expect(profiles[0]).toMatchObject({ symbol: 'TP53', ncbiGeneId: '7157', uniprotAccession: 'P04637' });

    const interactionsCsv = readFileSync(join(outdir, 'interactions.csv'), 'utf-8');
    expect(interactionsCsv).toContain('TP53');
    expect(interactionsCsv).toContain('EGFR');

    const sharedPathwaysCsv = readFileSync(join(outdir, 'shared_pathways.csv'), 'utf-8');
    expect(sharedPathwaysCsv).toContain('Pathways in cancer');
    expect(sharedPathwaysCsv).toContain('3');

    const goSummaryCsv = readFileSync(join(outdir, 'go_summary.csv'), 'utf-8');
    expect(goSummaryCsv).toContain('DNA damage response');
    expect(goSummaryCsv).toContain('Nucleus');

    const report = readFileSync(join(outdir, 'report.md'), 'utf-8');
    expect(report).toContain('# Gene Set Functional Profile');
    expect(report).toContain('## Shared Pathways');
    expect(report).toContain('## Protein Interactions');

    const manifest = JSON.parse(readFileSync(join(outdir, 'manifest.json'), 'utf-8'));
    expect(manifest.command).toBe('workflow-profile');
    expect(manifest.input.genes).toEqual(['TP53', 'EGFR', 'BRCA1']);
    expect(manifest.sources).toEqual(['NCBI Gene', 'UniProt', 'STRING', 'KEGG', 'Enrichr']);

    expect(result.sources).toEqual(['NCBI Gene', 'UniProt', 'STRING', 'KEGG', 'Enrichr']);
    expect(result.warnings).toEqual([]);
    const data = result.data as Record<string, unknown>;
    expect((data.summary as Record<string, unknown>)).toMatchObject({
      geneCount: 3,
      interactionCount: 2,
      sharedPathwayCount: 1,
      enrichmentTerms: 1,
    });
  });
});
