import { beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { FetchOptions, HttpContext } from '../../types.js';
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

import '../../clis/aggregate/tumor-gene-dossier.js';

const PUBMED_XML = `<?xml version="1.0" encoding="UTF-8"?>
<PubmedArticleSet>
  <PubmedArticle>
    <MedlineCitation>
      <PMID Version="1">36766853</PMID>
      <Article>
        <ArticleTitle>The Role of <i>TP53</i> in Cancer Biology.</ArticleTitle>
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
    fetchXml: async () => parseXml(PUBMED_XML),
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

function buildCbioPortalContext(): HttpContext {
  return {
    databaseId: 'cbioportal',
    fetch: unexpected('cbioportal.fetch'),
    fetchText: unexpected('cbioportal.fetchText'),
    fetchXml: unexpected('cbioportal.fetchXml'),
    fetchJson: async (url: string, opts?: FetchOptions) => {
      if (url.includes('/genes/fetch')) {
        return [{ entrezGeneId: 7157, hugoGeneSymbol: 'TP53', type: 'protein-coding' }];
      }
      if (url.includes('/studies/study/molecular-profiles')) {
        return [
          {
            molecularProfileId: 'study_mutations',
            molecularAlterationType: 'MUTATION_EXTENDED',
            datatype: 'MAF',
            studyId: 'study',
          },
        ];
      }
      if (url.includes('/studies/study/sample-lists')) {
        return [
          {
            sampleListId: 'study_sequenced',
            category: 'all_cases_with_mutation_data',
            studyId: 'study',
          },
        ];
      }
      if (url.includes('/sample-lists/study_sequenced?')) {
        return {
          sampleListId: 'study_sequenced',
          sampleCount: 10,
          sampleIds: ['S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7', 'S8', 'S9', 'S10'],
          studyId: 'study',
        };
      }
      if (url.includes('/mutations/fetch')) {
        const body = JSON.parse(String(opts?.body ?? '{}')) as {
          entrezGeneIds?: number[];
          sampleIds?: string[];
        };
        if (body.entrezGeneIds?.[0] === 7157 && url.includes('pageNumber=0')) {
          return [
            {
              sampleId: 'S1',
              patientId: 'P1',
              gene: { entrezGeneId: 7157, hugoGeneSymbol: 'TP53' },
              proteinChange: 'R273C',
              mutationType: 'Missense_Mutation',
              chr: '17',
              startPosition: 7577121,
              endPosition: 7577121,
              variantAllele: 'T',
              referenceAllele: 'C',
            },
            {
              sampleId: 'S2',
              patientId: 'P2',
              gene: { entrezGeneId: 7157, hugoGeneSymbol: 'TP53' },
              proteinChange: 'R248Q',
              mutationType: 'Missense_Mutation',
              chr: '17',
              startPosition: 7577538,
              endPosition: 7577538,
              variantAllele: 'T',
              referenceAllele: 'G',
            },
          ];
        }
        if (body.entrezGeneIds?.[0] === 7157 && url.includes('pageNumber=1')) {
          return [
            {
              sampleId: 'S2',
              patientId: 'P2',
              gene: { entrezGeneId: 7157, hugoGeneSymbol: 'TP53' },
              proteinChange: 'R248Q',
              mutationType: 'Missense_Mutation',
              chr: '17',
              startPosition: 7577538,
              endPosition: 7577538,
              variantAllele: 'T',
              referenceAllele: 'G',
            },
            {
              sampleId: 'S3',
              patientId: 'P3',
              gene: { entrezGeneId: 7157, hugoGeneSymbol: 'TP53' },
              proteinChange: 'H168Cfs*8',
              mutationType: 'Frame_Shift_Del',
              chr: '17',
              startPosition: 7578406,
              endPosition: 7578407,
              variantAllele: '-',
              referenceAllele: 'CC',
            },
          ];
        }
        if (body.entrezGeneIds?.[0] === 7157 && url.includes('pageNumber=2')) {
          return [];
        }
        // Co-mutation batched fetch (sampleIds + entrezGeneIds)
        if (body.sampleIds?.length === 3 && body.entrezGeneIds) {
          if (!url.includes('pageNumber=0')) return [];
          const mockPartners = [
            { entrezGeneId: 1956, hugoGeneSymbol: 'EGFR', mutations: [
              { sampleId: 'S1', patientId: 'P1', mutationType: 'Missense_Mutation', proteinChange: 'L858R' },
              { sampleId: 'S2', patientId: 'P2', mutationType: 'Missense_Mutation', proteinChange: 'E746_A750del' },
              { sampleId: 'S3', patientId: 'P3', mutationType: 'Amplification', proteinChange: '' },
            ]},
            { entrezGeneId: 672, hugoGeneSymbol: 'BRCA1', mutations: [
              { sampleId: 'S2', patientId: 'P2', mutationType: 'Nonsense_Mutation', proteinChange: 'Q1756*' },
              { sampleId: 'S3', patientId: 'P3', mutationType: 'Frame_Shift_Del', proteinChange: 'S1140fs' },
            ]},
          ];
          const results = [];
          for (const partner of mockPartners) {
            if (body.entrezGeneIds.includes(partner.entrezGeneId)) {
              for (const m of partner.mutations) {
                results.push({ ...m, gene: { entrezGeneId: partner.entrezGeneId, hugoGeneSymbol: partner.hugoGeneSymbol } });
              }
            }
          }
          return results;
        }
        // Legacy fallback (sampleIds without entrezGeneIds)
        if (body.sampleIds?.length === 3 && !body.entrezGeneIds) {
          if (url.includes('pageNumber=0')) {
            return [
              { sampleId: 'S1', patientId: 'P1', gene: { entrezGeneId: 1956, hugoGeneSymbol: 'EGFR' }, mutationType: 'Missense_Mutation', proteinChange: 'L858R' },
              { sampleId: 'S2', patientId: 'P2', gene: { entrezGeneId: 1956, hugoGeneSymbol: 'EGFR' }, mutationType: 'Missense_Mutation', proteinChange: 'E746_A750del' },
              { sampleId: 'S2', patientId: 'P2', gene: { entrezGeneId: 672, hugoGeneSymbol: 'BRCA1' }, mutationType: 'Nonsense_Mutation', proteinChange: 'Q1756*' },
            ];
          }
          if (url.includes('pageNumber=1')) {
            return [
              { sampleId: 'S3', patientId: 'P3', gene: { entrezGeneId: 1956, hugoGeneSymbol: 'EGFR' }, mutationType: 'Amplification', proteinChange: '' },
              { sampleId: 'S3', patientId: 'P3', gene: { entrezGeneId: 672, hugoGeneSymbol: 'BRCA1' }, mutationType: 'Frame_Shift_Del', proteinChange: 'S1140fs' },
            ];
          }
          if (url.includes('pageNumber=2')) return [];
        }
      }
      throw new Error(`Unhandled cBioPortal URL in test: ${url}`);
    },
  };
}

describe('aggregate/tumor-gene-dossier adapter', () => {
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
        case 'cbioportal':
          return buildCbioPortalContext();
        default:
          throw new Error(`Unexpected database: ${databaseId}`);
      }
    });
  });

  it('combines baseline gene dossier data with cBioPortal tumor summaries', async () => {
    const cmd = getRegistry().get('aggregate/tumor-gene-dossier');
    expect(cmd?.func).toBeTypeOf('function');

    const result = await cmd!.func!({} as HttpContext, {
      gene: 'TP53',
      study: 'study',
      organism: 'human',
      papers: 1,
      'co-mutations': 5,
      variants: 3,
      'min-co-samples': 2,
      'page-size': 2,
    });

    expect(result).toEqual(expect.objectContaining({
      ids: expect.objectContaining({
        ncbiGeneId: '7157',
        uniprotAccession: 'P04637',
        cbioportalEntrezGeneId: '7157',
        cbioportalStudyId: 'study',
        cbioportalMolecularProfileId: 'study_mutations',
        cbioportalSampleListId: 'study_sequenced',
      }),
      sources: expect.arrayContaining(['NCBI Gene', 'UniProt', 'STRING', 'PubMed', 'ClinVar', 'KEGG', 'cBioPortal']),
      warnings: [],
      completeness: 'complete',
      provenance: expect.objectContaining({
        sources: expect.arrayContaining([
          expect.objectContaining({
            source: 'PubMed',
            recordIds: ['36766853'],
          }),
          expect.objectContaining({
            source: 'cBioPortal',
            recordIds: [
              'study:study',
              'profile:study_mutations',
              'sampleList:study_sequenced',
              'gene:TP53',
            ],
          }),
        ]),
      }),
      data: expect.objectContaining({
        symbol: 'TP53',
        function: 'Acts as a tumor suppressor.',
        agentSummary: expect.objectContaining({
          topFinding: expect.stringContaining('TP53'),
          prevalence: {
            studyId: 'study',
            mutationFrequencyPct: 30,
            alteredSamples: 3,
            totalSamples: 10,
          },
          topCoMutations: [
            expect.objectContaining({
              partnerGene: 'EGFR',
              coMutatedSamples: 3,
              coMutationRateInAnchorPct: 100,
              contextTag: 'known_driver',
            }),
            expect.objectContaining({
              partnerGene: 'BRCA1',
              coMutatedSamples: 2,
              coMutationRateInAnchorPct: 66.67,
            }),
          ],
          exemplarVariants: expect.arrayContaining([
            expect.objectContaining({
              proteinChange: 'R248Q',
              mutationType: 'Missense_Mutation',
              sampleCount: 1,
            }),
          ]),
          cohortContext: {
            studyId: 'study',
            molecularProfileId: 'study_mutations',
            sampleListId: 'study_sequenced',
          },
          warnings: [],
          completeness: 'complete',
          recommendedNextStep: expect.objectContaining({
            type: 'inspect-cohort-context',
            command: 'biocli aggregate tumor-gene-dossier TP53 --study study -f json',
          }),
        }),
        tumor: expect.objectContaining({
          studyId: 'study',
          alterationStatus: 'altered',
          totalSamples: 10,
          alteredSamples: 3,
          uniquePatients: 3,
          mutationEvents: 4,
          mutationFrequencyPct: 30,
          topMutationTypes: [
            { mutationType: 'Missense_Mutation', count: 3 },
            { mutationType: 'Frame_Shift_Del', count: 1 },
          ],
          exemplarVariants: expect.arrayContaining([
            expect.objectContaining({
              proteinChange: 'R248Q',
              mutationType: 'Missense_Mutation',
              sampleCount: 1,
              patientCount: 1,
            }),
          ]),
          coMutations: [
            expect.objectContaining({
              partnerGene: 'EGFR',
              coMutatedSamples: 3,
              partnerMutationEvents: 3,
              coMutationRateInAnchorPct: 100,
            }),
            expect.objectContaining({
              partnerGene: 'BRCA1',
              coMutatedSamples: 2,
              coMutationRateInAnchorPct: 66.67,
            }),
          ],
        }),
      }),
    }));
  });

  it('supports batch execution through the shared aggregate batch runtime', async () => {
    const cmd = getRegistry().get('aggregate/tumor-gene-dossier');
    const result = await cmd!.func!({} as HttpContext, {
      gene: 'TP53,TP53',
      study: 'study',
      organism: 'human',
      papers: 1,
      'co-mutations': 5,
      variants: 3,
      'min-co-samples': 2,
      'page-size': 2,
      __batch: { concurrency: 2, retries: 0 },
    }) as Array<Record<string, unknown>>;

    expect(Array.isArray(result)).toBe(true);
    expect(result).toHaveLength(2);
    expect(result[0]?.query).toBe('TP53 @ study');
    expect(result[1]?.query).toBe('TP53 @ study');
  });

  it('writes batch artifacts when outdir is provided', async () => {
    const cmd = getRegistry().get('aggregate/tumor-gene-dossier');
    const outdir = mkdtempSync(join(tmpdir(), 'biocli-tumor-gene-dossier-batch-'));
    try {
      await cmd!.func!({} as HttpContext, {
        gene: 'TP53,TP53',
        study: 'study',
        organism: 'human',
        papers: 1,
        'co-mutations': 5,
        variants: 3,
        'min-co-samples': 2,
        'page-size': 2,
        __batch: { concurrency: 2, retries: 0, outdir },
      });

      expect(existsSync(join(outdir, 'results.jsonl'))).toBe(true);
      expect(existsSync(join(outdir, 'failures.jsonl'))).toBe(true);
      expect(existsSync(join(outdir, 'summary.json'))).toBe(true);
      expect(existsSync(join(outdir, 'summary.csv'))).toBe(true);
      expect(existsSync(join(outdir, 'manifest.json'))).toBe(true);
      expect(existsSync(join(outdir, 'methods.md'))).toBe(true);

      const manifest = JSON.parse(readFileSync(join(outdir, 'manifest.json'), 'utf-8'));
      const summaryCsv = readFileSync(join(outdir, 'summary.csv'), 'utf-8');
      const methodsMd = readFileSync(join(outdir, 'methods.md'), 'utf-8');

      expect(manifest.command).toBe('aggregate/tumor-gene-dossier');
      expect(manifest.inputSource).toBe('inline');
      expect(summaryCsv).toContain('studyId');
      expect(summaryCsv).toContain('TP53');
      expect(methodsMd).toContain('aggregate/tumor-gene-dossier batch (2 items)');
    } finally {
      rmSync(outdir, { recursive: true, force: true });
    }
  });

  it('can resume from an existing batch checkpoint without re-querying upstreams', async () => {
    const cmd = getRegistry().get('aggregate/tumor-gene-dossier');
    const outdir = mkdtempSync(join(tmpdir(), 'biocli-tumor-gene-dossier-resume-'));
    try {
      const cachedResult = {
        input: 'TP53',
        index: 0,
        attempts: 1,
        succeededAt: '2026-04-13T00:00:01.000Z',
        result: {
          biocliVersion: '0.5.0',
          query: 'TP53 @ study',
          organism: 'human',
          completeness: 'complete',
          queriedAt: '2026-04-13T00:00:01.000Z',
          sources: ['NCBI Gene', 'cBioPortal'],
          warnings: [],
          ids: {
            ncbiGeneId: '7157',
            uniprotAccession: 'P04637',
            cbioportalEntrezGeneId: '7157',
            cbioportalStudyId: 'study',
            cbioportalMolecularProfileId: 'study_mutations',
            cbioportalSampleListId: 'study_sequenced',
          },
          provenance: {
            retrievedAt: '2026-04-13T00:00:01.000Z',
            sources: [{ source: 'NCBI Gene' }, { source: 'cBioPortal' }],
          },
          data: {
            symbol: 'TP53',
            name: 'tumor protein p53',
            function: 'Acts as a tumor suppressor.',
            tumor: {
              studyId: 'study',
              molecularProfileId: 'study_mutations',
              sampleListId: 'study_sequenced',
              totalSamples: 10,
              alterationStatus: 'altered',
              alteredSamples: 3,
              uniquePatients: 3,
              mutationEvents: 4,
              mutationFrequency: 0.3,
              mutationFrequencyPct: 30,
              topMutationTypes: [],
              topProteinChanges: [],
              exemplarVariants: [],
              coMutations: [],
            },
          },
        },
      };
      writeFileSync(join(outdir, 'results.jsonl'), `${JSON.stringify(cachedResult)}\n`);
      writeFileSync(join(outdir, 'failures.jsonl'), '');

      createHttpContextForDatabaseMock.mockImplementation(() => {
        throw new Error('resume path should not fetch upstream data');
      });

      const result = await cmd!.func!({} as HttpContext, {
        gene: 'TP53',
        study: 'study',
        organism: 'human',
        papers: 1,
        'co-mutations': 5,
        variants: 3,
        'min-co-samples': 2,
        'page-size': 2,
        __batch: { outdir, resume: true, concurrency: 2, retries: 0 },
      }) as Array<Record<string, unknown>>;

      expect(result).toHaveLength(1);
      expect(result[0]?.query).toBe('TP53 @ study');
      const manifest = JSON.parse(readFileSync(join(outdir, 'manifest.json'), 'utf-8'));
      expect(manifest.succeeded).toBe(1);
      expect(manifest.failed).toBe(0);
    } finally {
      rmSync(outdir, { recursive: true, force: true });
    }
  });
});
