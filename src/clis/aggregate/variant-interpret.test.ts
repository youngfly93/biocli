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

import './variant-interpret.js';

function buildNcbiContext() {
  return {
    databaseId: 'ncbi',
    fetch: async () => { throw new Error('unexpected'); },
    fetchXml: async () => { throw new Error('unexpected'); },
    fetchText: async () => { throw new Error('unexpected'); },
    fetchJson: async (url: string) => {
      if (url.includes('esummary.fcgi') && url.includes('db=snp')) {
        return {
          result: {
            uids: ['334'],
            '334': {
              snp_id: 334,
              genes: [{ name: 'HBB' }],
              chr: '11',
              chrpos: '11:5227002',
              docsum: 'T>A',
              clinical_significance: ['pathogenic'],
            },
          },
        };
      }
      if (url.includes('esearch.fcgi') && url.includes('db=clinvar')) {
        return { esearchresult: { idlist: ['12345'], count: '1' } };
      }
      if (url.includes('esummary.fcgi') && url.includes('db=clinvar')) {
        return {
          result: {
            uids: ['12345'],
            '12345': {
              clinical_significance: { description: 'Pathogenic' },
              trait_set: [{ trait_name: 'Sickle cell disease' }],
              accession: 'VCV000012345',
            },
          },
        };
      }
      throw new Error(`Unexpected NCBI fetchJson: ${url}`);
    },
  };
}

function buildEnsemblContext() {
  return {
    databaseId: 'ensembl',
    fetch: async () => { throw new Error('unexpected'); },
    fetchXml: async () => { throw new Error('unexpected'); },
    fetchText: async () => { throw new Error('unexpected'); },
    fetchJson: async () => [{
      transcript_consequences: [{
        gene_symbol: 'HBB',
        transcript_id: 'ENST00000335295',
        consequence_terms: ['missense_variant'],
        impact: 'MODERATE',
        amino_acids: 'E/V',
        biotype: 'protein_coding',
        canonical: true,
      }],
    }],
  };
}

function buildUniprotContext() {
  return {
    databaseId: 'uniprot',
    fetch: async () => { throw new Error('unexpected'); },
    fetchXml: async () => { throw new Error('unexpected'); },
    fetchText: async () => { throw new Error('unexpected'); },
    fetchJson: async () => ({
      results: [{
        primaryAccession: 'P68871',
        comments: [{
          commentType: 'FUNCTION',
          texts: [{ value: 'Hemoglobin subunit beta.' }],
        }],
      }],
    }),
  };
}

describe('aggregate/variant-interpret', () => {
  beforeEach(() => {
    createHttpContextForDatabaseMock.mockReset();
    createHttpContextForDatabaseMock.mockImplementation((dbId: string) => {
      switch (dbId) {
        case 'ncbi': return buildNcbiContext();
        case 'ensembl': return buildEnsemblContext();
        case 'uniprot': return buildUniprotContext();
        default: throw new Error(`Unexpected database: ${dbId}`);
      }
    });
  });

  it('produces a structured interpretation for rs334', async () => {
    const cmd = getRegistry().get('aggregate/variant-interpret');
    expect(cmd?.func).toBeTypeOf('function');

    const result = await cmd!.func!({} as any, { variant: 'rs334' }) as Record<string, unknown>;
    expect(result).toEqual(expect.objectContaining({
      sources: expect.arrayContaining(['dbSNP', 'ClinVar', 'Ensembl VEP', 'UniProt']),
      query: 'rs334',
      completeness: 'complete',
      provenance: expect.objectContaining({
        sources: expect.arrayContaining([
          expect.objectContaining({
            source: 'dbSNP',
            recordIds: ['rs334'],
          }),
          expect.objectContaining({
            source: 'ClinVar',
            recordIds: ['VCV000012345'],
          }),
        ]),
      }),
    }));

    const data = result.data as Record<string, unknown>;
    expect(data.gene).toBe('HBB');
    expect(data.variant).toBe('rs334');

    const interp = data.interpretation as Record<string, unknown>;
    expect(interp.clinicalSignificance).toBe('Pathogenic');
    expect(interp.affectedGene).toBe('HBB');
    expect(interp.recommendation).toContain('genetic counseling');
    expect(interp.proteinFunction).toContain('Hemoglobin');
    expect((interp.conditions as string[]).length).toBeGreaterThan(0);
  });
});
