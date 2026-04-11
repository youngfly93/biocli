import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FetchOptions, HttpContext } from '../../types.js';
import { getRegistry } from '../../registry.js';

const {
  createHttpContextForDatabaseMock,
  loadGdscSensitivityIndexMock,
  findGdscDrugEntriesByNameMock,
} = vi.hoisted(() => ({
  createHttpContextForDatabaseMock: vi.fn(),
  loadGdscSensitivityIndexMock: vi.fn(),
  findGdscDrugEntriesByNameMock: vi.fn(),
}));

vi.mock('../../databases/index.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../databases/index.js')>();
  return {
    ...actual,
    createHttpContextForDatabase: createHttpContextForDatabaseMock,
  };
});

vi.mock('../../datasets/gdsc.js', () => ({
  loadGdscSensitivityIndex: loadGdscSensitivityIndexMock,
  findGdscDrugEntriesByName: findGdscDrugEntriesByNameMock,
}));

import '../../clis/aggregate/drug-target.js';

function unexpected(name: string) {
  return async () => {
    throw new Error(`Unexpected call to ${name}`);
  };
}

function buildOpenTargetsContext(): HttpContext {
  return {
    databaseId: 'opentargets',
    fetch: unexpected('opentargets.fetch'),
    fetchText: unexpected('opentargets.fetchText'),
    fetchXml: unexpected('opentargets.fetchXml'),
    fetchJson: async (_url: string, opts?: FetchOptions) => {
      const payload = JSON.parse(String(opts?.body ?? '{}')) as {
        query?: string;
        variables?: Record<string, unknown>;
      };
      const query = String(payload.query ?? '');

      if (query.includes('query SearchTargets')) {
        return {
          data: {
            search: {
              hits: [
                {
                  id: 'ENSG00000224057',
                  entity: 'target',
                  object: {
                    approvedSymbol: 'EGFR-AS1',
                    approvedName: 'EGFR antisense RNA 1',
                    biotype: 'lncRNA',
                  },
                },
                {
                  id: 'ENSG00000146648',
                  entity: 'target',
                  object: {
                    approvedSymbol: 'EGFR',
                    approvedName: 'epidermal growth factor receptor',
                    biotype: 'protein_coding',
                  },
                },
              ],
            },
          },
        };
      }

      if (query.includes('query TargetDrugSnapshot')) {
        expect(payload.variables).toMatchObject({
          ensemblId: 'ENSG00000146648',
        });
        return {
          data: {
            target: {
              id: 'ENSG00000146648',
              approvedSymbol: 'EGFR',
              approvedName: 'epidermal growth factor receptor',
              biotype: 'protein_coding',
              tractability: [
                { label: 'Approved Drug', modality: 'SM', value: true },
                { label: 'Structure with Ligand', modality: 'SM', value: true },
                { label: 'Approved Drug', modality: 'AB', value: true },
                { label: 'Phase 1 Clinical', modality: 'OC', value: false },
              ],
              associatedDiseases: {
                count: 3,
                rows: [
                  {
                    disease: { id: 'EFO_0003060', name: 'non-small cell lung carcinoma' },
                    score: 0.85,
                  },
                  {
                    disease: { id: 'EFO_0000571', name: 'lung adenocarcinoma' },
                    score: 0.76,
                  },
                  {
                    disease: { id: 'MONDO_0007254', name: 'breast cancer' },
                    score: 0.67,
                  },
                ],
              },
              drugAndClinicalCandidates: {
                count: 3,
                rows: [
                  {
                    id: 'cand-afatinib',
                    maxClinicalStage: 'APPROVAL',
                    drug: {
                      id: 'CHEMBL1173655',
                      name: 'AFATINIB',
                      maximumClinicalStage: 'APPROVAL',
                      drugType: 'Small molecule',
                    },
                    diseases: [
                      {
                        diseaseFromSource: 'non-small-cell lung cancer',
                        disease: { id: 'EFO_0003060', name: 'non-small cell lung carcinoma' },
                      },
                      {
                        diseaseFromSource: 'breast cancer',
                        disease: { id: 'MONDO_0007254', name: 'breast cancer' },
                      },
                    ],
                    clinicalReports: [
                      {
                        id: 'nct-afa-1',
                        source: 'AACT',
                        clinicalStage: 'APPROVAL',
                        trialPhase: 'PHASE3',
                        title: 'Afatinib in EGFR-mutant NSCLC',
                        url: 'https://clinicaltrials.gov/study/NCT00000001',
                        year: 2024,
                      },
                      {
                        id: 'ema-afatinib',
                        source: 'EMA Human Drugs',
                        clinicalStage: 'APPROVAL',
                        title: 'Afatinib approval',
                        url: 'https://example.org/ema-afatinib',
                        year: 2023,
                      },
                    ],
                  },
                  {
                    id: 'cand-osimertinib',
                    maxClinicalStage: 'APPROVAL',
                    drug: {
                      id: 'CHEMBL3353410',
                      name: 'OSIMERTINIB',
                      maximumClinicalStage: 'APPROVAL',
                      drugType: 'Small molecule',
                    },
                    diseases: [
                      {
                        diseaseFromSource: 'lung adenocarcinoma',
                        disease: { id: 'EFO_0000571', name: 'lung adenocarcinoma' },
                      },
                    ],
                    clinicalReports: [
                      {
                        id: 'nct-osi-1',
                        source: 'AACT',
                        clinicalStage: 'APPROVAL',
                        trialPhase: 'PHASE3',
                        title: 'Osimertinib in advanced NSCLC',
                        url: 'https://clinicaltrials.gov/study/NCT00000002',
                        year: 2025,
                      },
                    ],
                  },
                  {
                    id: 'cand-tesevatinib',
                    maxClinicalStage: 'PHASE_3',
                    drug: {
                      id: 'CHEMBL3544983',
                      name: 'TESEVATINIB',
                      maximumClinicalStage: 'PHASE_3',
                      drugType: 'Small molecule',
                    },
                    diseases: [
                      {
                        diseaseFromSource: 'polycystic kidney disease',
                        disease: { id: 'EFO_0008620', name: 'Polycystic Kidney Disease' },
                      },
                    ],
                    clinicalReports: [
                      {
                        id: 'nct-tes-1',
                        source: 'AACT',
                        clinicalStage: 'PHASE_3',
                        trialPhase: 'PHASE3',
                        title: 'Tesevatinib in ADPKD',
                        url: 'https://clinicaltrials.gov/study/NCT00000003',
                        year: 2022,
                      },
                    ],
                  },
                ],
              },
            },
          },
        };
      }

      if (query.includes('query DrugsByIds')) {
        expect(payload.variables).toEqual({
          chemblIds: ['CHEMBL1173655', 'CHEMBL3353410', 'CHEMBL3544983'],
        });
        return {
          data: {
            drugs: [
              {
                id: 'CHEMBL1173655',
                name: 'AFATINIB',
                maximumClinicalStage: 'APPROVAL',
                drugType: 'Small molecule',
                mechanismsOfAction: { uniqueActionTypes: ['INHIBITOR'] },
              },
              {
                id: 'CHEMBL3353410',
                name: 'OSIMERTINIB',
                maximumClinicalStage: 'APPROVAL',
                drugType: 'Small molecule',
                mechanismsOfAction: { uniqueActionTypes: ['INHIBITOR'] },
              },
              {
                id: 'CHEMBL3544983',
                name: 'TESEVATINIB',
                maximumClinicalStage: 'PHASE_3',
                drugType: 'Small molecule',
                mechanismsOfAction: { uniqueActionTypes: ['INHIBITOR'] },
              },
            ],
          },
        };
      }

      throw new Error(`Unhandled Open Targets query in test: ${query}`);
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
        return [{ entrezGeneId: 1956, hugoGeneSymbol: 'EGFR', type: 'protein-coding' }];
      }
      if (url.includes('/studies/luad?')) {
        return {
          studyId: 'luad',
          name: 'Lung Adenocarcinoma (Mock Cohort)',
          cancerType: {
            name: 'Lung Adenocarcinoma',
            shortName: 'LUAD',
            parent: 'nsclc',
          },
        };
      }
      if (url.includes('/studies/luad/molecular-profiles')) {
        return [{
          molecularProfileId: 'luad_mutations',
          molecularAlterationType: 'MUTATION_EXTENDED',
          datatype: 'MAF',
          studyId: 'luad',
        }];
      }
      if (url.includes('/studies/luad/sample-lists')) {
        return [{
          sampleListId: 'luad_sequenced',
          category: 'all_cases_with_mutation_data',
          studyId: 'luad',
        }];
      }
      if (url.includes('/sample-lists/luad_sequenced?')) {
        return {
          sampleListId: 'luad_sequenced',
          sampleCount: 10,
          sampleIds: ['S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7', 'S8', 'S9', 'S10'],
          studyId: 'luad',
        };
      }
      if (url.includes('/mutations/fetch')) {
        const body = JSON.parse(String(opts?.body ?? '{}')) as {
          entrezGeneIds?: number[];
          sampleIds?: string[];
        };
        if (body.entrezGeneIds?.[0] === 1956 && url.includes('pageNumber=0')) {
          return [
            {
              sampleId: 'S1',
              patientId: 'P1',
              gene: { entrezGeneId: 1956, hugoGeneSymbol: 'EGFR' },
              proteinChange: 'L858R',
              mutationType: 'Missense_Mutation',
              chr: '7',
              startPosition: 55259515,
              endPosition: 55259515,
              variantAllele: 'G',
              referenceAllele: 'T',
            },
            {
              sampleId: 'S2',
              patientId: 'P2',
              gene: { entrezGeneId: 1956, hugoGeneSymbol: 'EGFR' },
              proteinChange: 'E746_A750del',
              mutationType: 'In_Frame_Del',
              chr: '7',
              startPosition: 55242468,
              endPosition: 55242482,
              variantAllele: '-',
              referenceAllele: 'ELREA',
            },
          ];
        }
        if (body.entrezGeneIds?.[0] === 1956 && url.includes('pageNumber=1')) {
          return [];
        }
        if (Array.isArray(body.sampleIds) && body.sampleIds.length > 0 && url.includes('pageNumber=0')) {
          return [
            {
              sampleId: 'S1',
              patientId: 'P1',
              gene: { entrezGeneId: 1956, hugoGeneSymbol: 'EGFR' },
              proteinChange: 'L858R',
              mutationType: 'Missense_Mutation',
            },
            {
              sampleId: 'S1',
              patientId: 'P1',
              gene: { entrezGeneId: 7157, hugoGeneSymbol: 'TP53' },
              proteinChange: 'R273C',
              mutationType: 'Missense_Mutation',
            },
            {
              sampleId: 'S2',
              patientId: 'P2',
              gene: { entrezGeneId: 5290, hugoGeneSymbol: 'PIK3CA' },
              proteinChange: 'E545K',
              mutationType: 'Missense_Mutation',
            },
          ];
        }
        if (Array.isArray(body.sampleIds) && body.sampleIds.length > 0 && url.includes('pageNumber=1')) {
          return [];
        }
      }

      throw new Error(`Unhandled cBioPortal URL in test: ${url}`);
    },
  };
}

function buildGdscIndex() {
  const drugs = {
    '1032': {
      compound: {
        drugId: '1032',
        drugName: 'Afatinib',
        synonyms: ['Gilotrif'],
        target: 'EGFR, ERBB2',
        targetPathway: 'EGFR signaling',
      },
      totalRowCount: 14,
      strongSensitiveCount: 8,
      datasets: [
        {
          dataset: 'GDSC1',
          rowCount: 8,
          strongSensitiveCount: 5,
          bestZScore: -2.31,
          topHits: [
            { dataset: 'GDSC1', cellLineName: 'HCC827', sangerModelId: 'SIDM00001', tissue: 'Lung Adenocarcinoma', zScore: -2.31, auc: 0.21, lnIc50: -1.42 },
          ],
          tissues: [
            {
              tissue: 'Lung Adenocarcinoma',
              rowCount: 8,
              strongSensitiveCount: 5,
              bestZScore: -2.31,
              topHits: [
                { dataset: 'GDSC1', cellLineName: 'HCC827', sangerModelId: 'SIDM00001', tissue: 'Lung Adenocarcinoma', zScore: -2.31, auc: 0.21, lnIc50: -1.42 },
                { dataset: 'GDSC1', cellLineName: 'PC9', sangerModelId: 'SIDM00002', tissue: 'Lung Adenocarcinoma', zScore: -1.88, auc: 0.29, lnIc50: -1.08 },
              ],
            },
          ],
        },
        {
          dataset: 'GDSC2',
          rowCount: 6,
          strongSensitiveCount: 3,
          bestZScore: -1.72,
          topHits: [
            { dataset: 'GDSC2', cellLineName: 'H1975', sangerModelId: 'SIDM00003', tissue: 'Non Small Cell Lung Carcinoma', zScore: -1.72, auc: 0.34, lnIc50: -0.77 },
          ],
          tissues: [
            {
              tissue: 'Non Small Cell Lung Carcinoma',
              rowCount: 6,
              strongSensitiveCount: 3,
              bestZScore: -1.72,
              topHits: [
                { dataset: 'GDSC2', cellLineName: 'H1975', sangerModelId: 'SIDM00003', tissue: 'Non Small Cell Lung Carcinoma', zScore: -1.72, auc: 0.34, lnIc50: -0.77 },
              ],
            },
          ],
        },
      ],
    },
    '1919': {
      compound: {
        drugId: '1919',
        drugName: 'Osimertinib',
        synonyms: ['Tagrisso'],
        target: 'EGFR',
        targetPathway: 'EGFR signaling',
      },
      totalRowCount: 5,
      strongSensitiveCount: 2,
      datasets: [
        {
          dataset: 'GDSC2',
          rowCount: 5,
          strongSensitiveCount: 2,
          bestZScore: -1.11,
          topHits: [
            { dataset: 'GDSC2', cellLineName: 'HCC4006', sangerModelId: 'SIDM00004', tissue: 'Lung Adenocarcinoma', zScore: -1.11, auc: 0.41, lnIc50: -0.35 },
          ],
          tissues: [
            {
              tissue: 'Lung Adenocarcinoma',
              rowCount: 5,
              strongSensitiveCount: 2,
              bestZScore: -1.11,
              topHits: [
                { dataset: 'GDSC2', cellLineName: 'HCC4006', sangerModelId: 'SIDM00004', tissue: 'Lung Adenocarcinoma', zScore: -1.11, auc: 0.41, lnIc50: -0.35 },
              ],
            },
          ],
        },
      ],
    },
  };
  return {
    meta: { release: '8.5' },
    aliases: {},
    drugs,
  };
}

function buildGdscIndexWithLateStrongHit() {
  const index = buildGdscIndex();
  index.drugs['1032'].datasets[0] = {
    dataset: 'GDSC1',
    rowCount: 12,
    strongSensitiveCount: 4,
    bestZScore: -3.2,
    topHits: [
      {
        dataset: 'GDSC1',
        cellLineName: 'RARE1',
        sangerModelId: 'SIDM99999',
        tissue: 'Rare Tissue',
        zScore: -3.2,
        auc: 0.11,
        lnIc50: -2.2,
      },
      {
        dataset: 'GDSC1',
        cellLineName: 'COMMON1',
        sangerModelId: 'SIDM00010',
        tissue: 'Tissue A',
        zScore: -1.6,
        auc: 0.31,
        lnIc50: -0.8,
      },
    ],
    tissues: [
      {
        tissue: 'Tissue A',
        rowCount: 4,
        strongSensitiveCount: 1,
        bestZScore: -1.6,
        topHits: [
          { dataset: 'GDSC1', cellLineName: 'COMMON1', sangerModelId: 'SIDM00010', tissue: 'Tissue A', zScore: -1.6, auc: 0.31, lnIc50: -0.8 },
        ],
      },
      {
        tissue: 'Tissue B',
        rowCount: 3,
        strongSensitiveCount: 1,
        bestZScore: -1.5,
        topHits: [
          { dataset: 'GDSC1', cellLineName: 'COMMON2', sangerModelId: 'SIDM00011', tissue: 'Tissue B', zScore: -1.5, auc: 0.35, lnIc50: -0.7 },
        ],
      },
      {
        tissue: 'Tissue C',
        rowCount: 3,
        strongSensitiveCount: 1,
        bestZScore: -1.4,
        topHits: [
          { dataset: 'GDSC1', cellLineName: 'COMMON3', sangerModelId: 'SIDM00012', tissue: 'Tissue C', zScore: -1.4, auc: 0.39, lnIc50: -0.6 },
        ],
      },
      {
        tissue: 'Rare Tissue',
        rowCount: 2,
        strongSensitiveCount: 1,
        bestZScore: -3.2,
        topHits: [
          { dataset: 'GDSC1', cellLineName: 'RARE1', sangerModelId: 'SIDM99999', tissue: 'Rare Tissue', zScore: -3.2, auc: 0.11, lnIc50: -2.2 },
        ],
      },
    ],
  };
  return index;
}

describe('aggregate/drug-target', () => {
  beforeEach(() => {
    createHttpContextForDatabaseMock.mockReset();
    loadGdscSensitivityIndexMock.mockReset();
    findGdscDrugEntriesByNameMock.mockReset();
    createHttpContextForDatabaseMock.mockImplementation((databaseId: string) => {
      if (databaseId === 'opentargets') return buildOpenTargetsContext();
      if (databaseId === 'cbioportal') return buildCbioPortalContext();
      if (databaseId === 'gdsc') {
        return {
          databaseId: 'gdsc',
          fetch: unexpected('gdsc.fetch'),
          fetchJson: unexpected('gdsc.fetchJson'),
          fetchText: unexpected('gdsc.fetchText'),
          fetchXml: unexpected('gdsc.fetchXml'),
        } as unknown as HttpContext;
      }
      throw new Error(`Unexpected database context request: ${databaseId}`);
    });
    loadGdscSensitivityIndexMock.mockResolvedValue(buildGdscIndex());
    findGdscDrugEntriesByNameMock.mockImplementation((index: { drugs: Record<string, { compound: { drugName: string; synonyms: string[] } }> }, name: string) => {
      const normalized = name.toLowerCase();
      return Object.values(index.drugs).filter(entry =>
        entry.compound.drugName.toLowerCase() === normalized
        || entry.compound.synonyms.some(item => item.toLowerCase() === normalized));
    });
  });

  it('builds a lung-focused drug-target summary from Open Targets', async () => {
    const command = getRegistry().get('aggregate/drug-target');
    expect(command?.func).toBeTypeOf('function');

    const result = await command!.func!(
      {} as HttpContext,
      { gene: 'EGFR', disease: 'lung', limit: 5, diseaseLimit: 5, reportLimit: 2 },
    ) as Record<string, unknown>;

    expect(result.sources).toEqual(['Open Targets', 'GDSC']);
    expect(result.ids).toEqual({ ensemblGeneId: 'ENSG00000146648' });
    expect(result.warnings).toEqual([]);
    expect(result.completeness).toBe('complete');
    expect(result.provenance).toMatchObject({
      sources: expect.arrayContaining([
        expect.objectContaining({
          source: 'Open Targets',
          recordIds: ['ENSG00000146648'],
        }),
        expect.objectContaining({
          source: 'GDSC',
          databaseRelease: '8.5',
        }),
      ]),
    });

    const data = result.data as Record<string, unknown>;
    expect(data.target).toMatchObject({
      symbol: 'EGFR',
      ensemblId: 'ENSG00000146648',
    });
    expect(data.summary).toMatchObject({
      rankingMode: 'disease-aware',
      diseaseFilter: 'lung',
      totalCandidates: 3,
      matchedCandidates: 2,
      approvedDrugs: 2,
      sensitivitySupportedCandidates: 2,
    });
    expect(data.tractability).toMatchObject({
      positiveFeatureCount: 3,
    });
    expect(data.associatedDiseases).toHaveLength(3);

    const candidates = data.candidates as Array<Record<string, unknown>>;
    expect(candidates).toHaveLength(2);
    expect(candidates.map(item => item.drugName)).toEqual(['AFATINIB', 'OSIMERTINIB']);
    expect(candidates[0]).toMatchObject({
      chemblId: 'CHEMBL1173655',
      maxClinicalStage: 'APPROVAL',
      actionTypes: ['INHIBITOR'],
      ranking: {
        matchedDiseaseTerms: ['lung'],
      },
      sensitivity: {
        source: 'GDSC',
      },
    });
    expect((candidates[0]?.sensitivity as Record<string, unknown>).matchedTissues).toEqual(
      expect.arrayContaining(['Lung Adenocarcinoma']),
    );
    expect(candidates[0]?.evidenceSourceCounts).toEqual([
      { source: 'AACT', count: 1 },
      { source: 'EMA Human Drugs', count: 1 },
    ]);
  });

  it('returns a warning when disease filtering removes all candidates', async () => {
    const command = getRegistry().get('aggregate/drug-target');
    const result = await command!.func!(
      {} as HttpContext,
      { gene: 'EGFR', disease: 'sarcoma', limit: 5, diseaseLimit: 5, reportLimit: 2 },
    ) as Record<string, unknown>;

    expect(result.warnings).toEqual([
      'No drug candidates matched disease filter "sarcoma".',
    ]);
    const data = result.data as Record<string, unknown>;
    expect(data.summary).toMatchObject({
      diseaseFilter: 'sarcoma',
      totalCandidates: 3,
      matchedCandidates: 0,
      approvedDrugs: 0,
      sensitivitySupportedCandidates: 0,
    });
    expect(data.candidates).toEqual([]);
  });

  it('keeps summary counts based on all matched candidates even when the returned list is limited', async () => {
    const command = getRegistry().get('aggregate/drug-target');
    const result = await command!.func!(
      {} as HttpContext,
      { gene: 'EGFR', disease: 'lung', limit: 1, diseaseLimit: 5, reportLimit: 2 },
    ) as Record<string, unknown>;

    const data = result.data as Record<string, unknown>;
    expect(data.summary).toMatchObject({
      totalCandidates: 3,
      matchedCandidates: 2,
      returnedCandidates: 1,
      approvedDrugs: 2,
      clinicalCandidates: 2,
      sensitivitySupportedCandidates: 2,
    });
    expect((data.candidates as Array<Record<string, unknown>>)).toHaveLength(1);
  });

  it('keeps the dataset-wide strongest GDSC hit when no tissue filter is provided', async () => {
    loadGdscSensitivityIndexMock.mockResolvedValueOnce(buildGdscIndexWithLateStrongHit());
    const command = getRegistry().get('aggregate/drug-target');
    const result = await command!.func!(
      {} as HttpContext,
      { gene: 'EGFR', limit: 2, diseaseLimit: 5, reportLimit: 2 },
    ) as Record<string, unknown>;

    const data = result.data as Record<string, unknown>;
    const candidates = data.candidates as Array<Record<string, unknown>>;
    expect(candidates[0]?.drugName).toBe('AFATINIB');
    expect((candidates[0]?.sensitivity as Record<string, unknown>).strongestHits).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          cellLineName: 'RARE1',
          tissue: 'Rare Tissue',
          zScore: -3.2,
        }),
      ]),
    );
  });

  it('adds a cBioPortal tumor overlay when study is provided', async () => {
    const command = getRegistry().get('aggregate/drug-target');
    const result = await command!.func!(
      {} as HttpContext,
      {
        gene: 'EGFR',
        disease: 'lung',
        study: 'luad',
        limit: 5,
        diseaseLimit: 5,
        reportLimit: 2,
        'co-mutations': 5,
        variants: 3,
        'min-co-samples': 1,
        'page-size': 500,
      },
    ) as Record<string, unknown>;

    expect(result.sources).toEqual(['Open Targets', 'GDSC', 'cBioPortal']);
    expect(result.ids).toMatchObject({
      ensemblGeneId: 'ENSG00000146648',
      cbioportalEntrezGeneId: '1956',
      cbioportalStudyId: 'luad',
    });
    expect(result.query).toBe('EGFR [disease=lung] @ luad');
    expect(result.provenance).toMatchObject({
      sources: expect.arrayContaining([
        expect.objectContaining({ source: 'Open Targets' }),
        expect.objectContaining({ source: 'GDSC' }),
        expect.objectContaining({ source: 'cBioPortal' }),
      ]),
    });

    const data = result.data as Record<string, unknown>;
    expect(data.summary).toMatchObject({
      rankingMode: 'study-aware',
      diseaseFilter: 'lung',
      sensitivitySupportedCandidates: 2,
    });
    const candidates = data.candidates as Array<Record<string, unknown>>;
    expect(candidates[0]?.drugName).toBe('AFATINIB');
    expect((candidates[0]?.ranking as Record<string, unknown>).matchedDiseaseTerms).toEqual(['lung']);
    expect((candidates[0]?.ranking as Record<string, unknown>).matchedGeneTerms).toEqual(
      expect.arrayContaining(['egfr']),
    );
    expect((candidates[0]?.ranking as Record<string, unknown>).matchedStudyTerms).toEqual(
      expect.arrayContaining(['non small cell lung carcinoma']),
    );
    expect(candidates[0]?.sensitivity).toMatchObject({
      source: 'GDSC',
    });
    expect(data.tumorStudy).toMatchObject({
      studyId: 'luad',
      alteredSamples: 2,
      mutationFrequencyPct: 20,
      mutationEvents: 2,
      alterationStatus: 'altered',
    });
    const tumorStudy = data.tumorStudy as Record<string, unknown>;
    expect(tumorStudy.exemplarVariants).toHaveLength(2);
    expect(tumorStudy.coMutations).toHaveLength(2);
  });
});
