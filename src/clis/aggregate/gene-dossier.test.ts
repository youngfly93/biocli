import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { HttpContext } from '../../types.js';
import { getRegistry } from '../../registry.js';
import { parseXml } from '../../xml-parser.js';

const { createHttpContextForDatabaseMock } = vi.hoisted(() => ({
  createHttpContextForDatabaseMock: vi.fn(),
}));

vi.mock('../../databases/index.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../databases/index.js')>();
  return {
    ...actual,
    createHttpContextForDatabase: createHttpContextForDatabaseMock,
  };
});

import '../../clis/aggregate/gene-dossier.js';

const PUBMED_XML = `<?xml version="1.0" encoding="UTF-8"?>
<PubmedArticleSet>
  <PubmedArticle>
    <MedlineCitation>
      <PMID Version="1">36766853</PMID>
      <Article>
        <ArticleTitle>The Role of <i>TP53</i> in Adaptation and Evolution.</ArticleTitle>
        <Abstract>
          <AbstractText>The <i>TP53</i> gene is a major player in cancer formation.</AbstractText>
        </Abstract>
        <Journal>
          <JournalIssue>
            <PubDate>
              <Year>2023</Year>
            </PubDate>
          </JournalIssue>
          <Title>Cells</Title>
        </Journal>
        <AuthorList>
          <Author>
            <LastName>Voskarides</LastName>
            <ForeName>Konstantinos</ForeName>
          </Author>
          <Author>
            <LastName>Giannopoulou</LastName>
            <ForeName>Nefeli</ForeName>
          </Author>
        </AuthorList>
        <ELocationID EIdType="doi">10.3390/cells12030512</ELocationID>
      </Article>
    </MedlineCitation>
  </PubmedArticle>
</PubmedArticleSet>`;

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
    fetchXml: async (url: string) => {
      const parsed = new URL(url);
      expect(parsed.pathname).toContain('efetch.fcgi');
      expect(parsed.searchParams.get('db')).toBe('pubmed');
      return parseXml(PUBMED_XML);
    },
    fetchJson: async (url: string) => {
      const parsed = new URL(url);
      const tool = parsed.pathname.split('/').pop();
      const db = parsed.searchParams.get('db');

      if (tool === 'esearch.fcgi' && db === 'gene') {
        return { esearchresult: { idlist: ['7157'] } };
      }
      if (tool === 'esummary.fcgi' && db === 'gene') {
        return {
          result: {
            uids: ['7157'],
            '7157': {
              uid: '7157',
              name: 'TP53',
              description: 'tumor protein p53',
              organism: { scientificname: 'Homo sapiens' },
              summary: 'Tumor suppressor involved in DNA damage response.',
              chromosome: '17',
              maplocation: '17p13.1',
            },
          },
        };
      }
      if (tool === 'esearch.fcgi' && db === 'pubmed') {
        return { esearchresult: { idlist: ['36766853'] } };
      }
      if (tool === 'esearch.fcgi' && db === 'clinvar') {
        return { esearchresult: { idlist: ['123'] } };
      }
      if (tool === 'esummary.fcgi' && db === 'clinvar') {
        return {
          result: {
            uids: ['123'],
            '123': {
              title: 'NM_000546.6(TP53):c.215C>G (p.Pro72Arg)',
              clinical_significance: { description: 'Pathogenic' },
              trait_set: [{ trait_name: 'Li-Fraumeni syndrome' }],
              accession: 'VCV000000123',
            },
          },
        };
      }

      throw new Error(`Unhandled NCBI URL in test: ${url}`);
    },
  };
}

function buildUniProtContext(): HttpContext {
  return {
    databaseId: 'uniprot',
    fetch: unexpected('uniprot.fetch'),
    fetchText: unexpected('uniprot.fetchText'),
    fetchXml: unexpected('uniprot.fetchXml'),
    fetchJson: async () => ({
      results: [
        {
          primaryAccession: 'P04637',
          comments: [
            {
              commentType: 'FUNCTION',
              texts: [{ value: 'Acts as a tumor suppressor.' }],
            },
          ],
          uniProtKBCrossReferences: [
            {
              database: 'GO',
              id: 'GO:0006915',
              properties: [{ key: 'GoTerm', value: 'P:apoptotic process' }],
            },
          ],
        },
      ],
    }),
  };
}

function buildStringContext(): HttpContext {
  return {
    databaseId: 'string',
    fetch: unexpected('string.fetch'),
    fetchText: unexpected('string.fetchText'),
    fetchXml: unexpected('string.fetchXml'),
    fetchJson: async () => [
      { preferredName_B: 'MDM2', score: 0.999 },
      { preferredName_B: 'BAX', score: 0.998 },
    ],
  };
}

function buildKeggContext(): HttpContext {
  return {
    databaseId: 'kegg',
    fetch: unexpected('kegg.fetch'),
    fetchJson: unexpected('kegg.fetchJson'),
    fetchXml: unexpected('kegg.fetchXml'),
    fetchText: async (url: string) => {
      if (url.includes('/link/pathway/')) {
        return 'hsa:7157\tpath:hsa04115\n';
      }
      if (url.includes('/list/pathway/')) {
        return 'hsa04115\tp53 signaling pathway - Homo sapiens (human)\n';
      }
      throw new Error(`Unhandled KEGG URL in test: ${url}`);
    },
  };
}

describe('aggregate/gene-dossier adapter', () => {
  beforeEach(() => {
    createHttpContextForDatabaseMock.mockReset();
    createHttpContextForDatabaseMock.mockImplementation((databaseId: string) => {
      switch (databaseId) {
        case 'ncbi':
          return buildNcbiContext();
        case 'uniprot':
          return buildUniProtContext();
        case 'string':
          return buildStringContext();
        case 'kegg':
          return buildKeggContext();
        default:
          throw new Error(`Unexpected database: ${databaseId}`);
      }
    });
  });

  it('returns GO terms, literature, and clinical layers in the result envelope', async () => {
    const cmd = getRegistry().get('aggregate/gene-dossier');
    expect(cmd?.func).toBeTypeOf('function');

    const result = await cmd!.func!({} as HttpContext, { gene: 'TP53', organism: 'human', papers: 1 });
    expect(result).toEqual(
      expect.objectContaining({
        ids: expect.objectContaining({
          ncbiGeneId: '7157',
          uniprotAccession: 'P04637',
          keggId: 'hsa:7157',
        }),
        sources: expect.arrayContaining(['NCBI Gene', 'UniProt', 'STRING', 'PubMed', 'ClinVar', 'KEGG']),
        warnings: [],
        organism: 'Homo sapiens',
        query: 'TP53',
        completeness: 'complete',
        provenance: expect.objectContaining({
          sources: expect.arrayContaining([
            expect.objectContaining({
              source: 'NCBI Gene',
              recordIds: ['7157'],
            }),
            expect.objectContaining({
              source: 'PubMed',
              recordIds: ['36766853'],
            }),
            expect.objectContaining({
              source: 'ClinVar',
              recordIds: ['VCV000000123'],
            }),
          ]),
        }),
        data: expect.objectContaining({
          symbol: 'TP53',
          function: 'Acts as a tumor suppressor.',
          pathways: [{ id: 'hsa04115', name: 'p53 signaling pathway' }],
          goTerms: [{ id: 'GO:0006915', name: 'apoptotic process', aspect: 'BP' }],
          interactions: [
            { partner: 'MDM2', score: 0.999 },
            { partner: 'BAX', score: 0.998 },
          ],
          recentLiterature: [
            expect.objectContaining({
              pmid: '36766853',
              title: 'The Role of TP53 in Adaptation and Evolution.',
            }),
          ],
          clinicalVariants: [
            expect.objectContaining({
              accession: 'VCV000000123',
              significance: 'Pathogenic',
              condition: 'Li-Fraumeni syndrome',
            }),
          ],
        }),
      }),
    );
  });
});
