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

import './workflow-annotate.js';

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
      if (url.includes('esummary.fcgi') && url.includes('7157')) {
        return {
          result: {
            uids: ['7157'],
            '7157': {
              uid: '7157',
              name: 'TP53',
              description: 'tumor protein p53',
              chromosome: '17',
              maplocation: '17p13.1',
              summary: 'Tumor suppressor.',
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
              chromosome: '7',
              maplocation: '7p11.2',
              summary: 'Receptor tyrosine kinase.',
            },
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
            comments: [
              { commentType: 'FUNCTION', texts: [{ value: 'DNA damage checkpoint regulator.' }] },
              { commentType: 'SUBCELLULAR LOCATION', subcellularLocations: [{ location: { value: 'Nucleus' } }] },
            ],
            uniProtKBCrossReferences: [
              { database: 'GO', id: 'GO:0006977', properties: [{ key: 'GoTerm', value: 'P:DNA damage response' }] },
            ],
          }],
        };
      }
      if (url.includes('gene%3AEGFR')) {
        return {
          results: [{
            primaryAccession: 'P00533',
            genes: [{ geneName: { value: 'EGFR' } }],
            comments: [
              { commentType: 'FUNCTION', texts: [{ value: 'Cell surface receptor kinase.' }] },
              { commentType: 'SUBCELLULAR LOCATION', subcellularLocations: [{ location: { value: 'Membrane' } }] },
            ],
            uniProtKBCrossReferences: [
              { database: 'GO', id: 'GO:0007173', properties: [{ key: 'GoTerm', value: 'P:EGFR signaling pathway' }] },
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
      if (url.endsWith('/list/pathway/hsa')) {
        return [
          'path:hsa04115\tp53 signaling pathway - Homo sapiens (human)',
          'path:hsa04012\tErbB signaling pathway - Homo sapiens (human)',
          'path:hsa05200\tPathways in cancer - Homo sapiens (human)',
          '',
        ].join('\n');
      }
      throw new Error(`Unhandled KEGG URL: ${url}`);
    },
  };
}

describe('aggregate/workflow-annotate', () => {
  const tempDirs: string[] = [];

  beforeEach(() => {
    createHttpContextForDatabaseMock.mockReset();
    submitGeneListMock.mockReset();
    getEnrichmentMock.mockReset();

    createHttpContextForDatabaseMock.mockImplementation((databaseId: string) => {
      if (databaseId === 'ncbi') return buildNcbiContext();
      if (databaseId === 'uniprot') return buildUniprotContext();
      if (databaseId === 'kegg') return buildKeggContext();
      throw new Error(`Unexpected database: ${databaseId}`);
    });

    submitGeneListMock.mockResolvedValue(12345);
    getEnrichmentMock.mockResolvedValue([
      {
        term: 'p53 signaling pathway',
        adjustedPValue: 2e-6,
        combinedScore: 37.5,
        genes: 'TP53,EGFR',
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
    const dir = mkdtempSync(resolve(tmpdir(), `biocli-workflow-annotate-${name}-`));
    tempDirs.push(dir);
    return join(dir, 'out');
  }

  it('returns a plan without writing files', async () => {
    const cmd = getRegistry().get('aggregate/workflow-annotate');
    expect(cmd?.func).toBeTypeOf('function');

    const outdir = makeOutdir('plan');
    const result = await cmd!.func!({} as never, {
      genes: 'TP53,EGFR',
      outdir,
      organism: 'human',
      library: 'KEGG_2021_Human',
      plan: true,
    }) as Record<string, unknown>;

    const data = result.data as Record<string, unknown>;
    expect(data.plan).toHaveLength(4);
    expect(data.outdir).toBe(outdir);
    expect(result.sources).toEqual([]);
    expect(existsSync(outdir)).toBe(false);
  });

  it('writes annotation outputs, report, summary, and manifest', async () => {
    const cmd = getRegistry().get('aggregate/workflow-annotate');
    expect(cmd?.func).toBeTypeOf('function');

    const outdir = makeOutdir('run');
    const result = await cmd!.func!({} as never, {
      genes: 'TP53,EGFR',
      outdir,
      organism: 'human',
      library: 'KEGG_2021_Human',
    }) as Record<string, unknown>;

    expect(existsSync(join(outdir, 'genes.csv'))).toBe(true);
    expect(existsSync(join(outdir, 'pathways.csv'))).toBe(true);
    expect(existsSync(join(outdir, 'enrichment.csv'))).toBe(true);
    expect(existsSync(join(outdir, 'report.md'))).toBe(true);
    expect(existsSync(join(outdir, 'summary.json'))).toBe(true);
    expect(existsSync(join(outdir, 'manifest.json'))).toBe(true);

    const genesCsv = readFileSync(join(outdir, 'genes.csv'), 'utf-8');
    expect(genesCsv).toContain('TP53');
    expect(genesCsv).toContain('P04637');

    const pathwaysCsv = readFileSync(join(outdir, 'pathways.csv'), 'utf-8');
    expect(pathwaysCsv).toContain('p53 signaling pathway');
    expect(pathwaysCsv).toContain('Pathways in cancer');

    const enrichmentCsv = readFileSync(join(outdir, 'enrichment.csv'), 'utf-8');
    expect(enrichmentCsv).toContain('p53 signaling pathway');

    const report = readFileSync(join(outdir, 'report.md'), 'utf-8');
    expect(report).toContain('# Gene Annotation Report');
    expect(report).toContain('## KEGG Pathways');

    const summary = JSON.parse(readFileSync(join(outdir, 'summary.json'), 'utf-8'));
    expect(summary).toMatchObject({
      geneCount: 2,
      annotatedCount: 2,
      pathwayCount: 3,
      enrichmentTerms: 1,
    });

    const manifest = JSON.parse(readFileSync(join(outdir, 'manifest.json'), 'utf-8'));
    expect(manifest.command).toBe('workflow-annotate');
    expect(manifest.input.genes).toEqual(['TP53', 'EGFR']);
    expect(manifest.sources).toEqual(['NCBI Gene', 'UniProt', 'KEGG', 'Enrichr']);

    expect(result.sources).toEqual(['NCBI Gene', 'UniProt', 'KEGG', 'Enrichr']);
    expect(result.warnings).toEqual([]);
    const data = result.data as Record<string, unknown>;
    expect((data.steps as Array<Record<string, unknown>>).map(step => step.step)).toEqual([
      'gene-annotations',
      'pathways',
      'enrichment',
      'report',
      'manifest',
    ]);
  });
});
