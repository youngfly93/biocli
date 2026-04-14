import { describe, expect, it } from 'vitest';
import { flattenBatchSuccesses } from './batch-flatteners.js';

describe('flattenBatchSuccesses', () => {
  it('flattens aggregate/gene-profile results into summary rows', () => {
    const table = flattenBatchSuccesses('aggregate/gene-profile', [{
      input: 'TP53',
      index: 0,
      attempts: 1,
      succeededAt: '2026-04-12T00:00:00.000Z',
      result: {
        query: 'TP53',
        organism: 'human',
        completeness: 'complete',
        queriedAt: '2026-04-12T00:00:00.000Z',
        sources: ['NCBI Gene', 'UniProt'],
        warnings: [],
        ids: { ncbiGeneId: '7157', uniprotAccession: 'P04637', ensemblGeneId: 'ENSG00000141510' },
        data: {
          symbol: 'TP53',
          name: 'tumor protein p53',
          pathways: [{ id: 'hsa04115' }],
          goTerms: [{ id: 'GO:1' }, { id: 'GO:2' }],
          interactions: [{ partner: 'MDM2' }],
          diseases: [],
        },
      },
    }]);

    expect(table).not.toBeNull();
    expect(table!.headers).toContain('pathwayCount');
    expect(table!.rows[0].symbol).toBe('TP53');
    expect(table!.rows[0].pathwayCount).toBe(1);
    expect(table!.rows[0].goTermCount).toBe(2);
  });

  it('flattens aggregate/drug-target results into summary rows', () => {
    const table = flattenBatchSuccesses('aggregate/drug-target', [{
      input: 'EGFR',
      index: 0,
      attempts: 1,
      succeededAt: '2026-04-13T00:00:00.000Z',
      result: {
        query: 'EGFR [disease=lung]',
        completeness: 'complete',
        queriedAt: '2026-04-13T00:00:00.000Z',
        sources: ['Open Targets', 'GDSC'],
        warnings: [],
        ids: { ensemblGeneId: 'ENSG00000146648' },
        data: {
          target: { symbol: 'EGFR', name: 'epidermal growth factor receptor' },
          summary: {
            rankingMode: 'disease-aware',
            diseaseFilter: 'lung',
            totalCandidates: 3,
            matchedCandidates: 2,
            returnedCandidates: 2,
            approvedDrugs: 2,
            clinicalCandidates: 2,
            sensitivitySupportedCandidates: 2,
          },
          agentSummary: {
            topFinding: 'EGFR has approval-stage candidates for lung cancer led by AFATINIB.',
            matchedDisease: 'lung',
            topCandidates: [{
              drugName: 'AFATINIB',
              maxClinicalStageLabel: 'Approved',
              score: 12.4,
              reasons: ['disease match', 'approval-stage evidence'],
            }],
            topSensitivitySignals: [{
              drugName: 'AFATINIB',
              dataset: 'GDSC2',
              tissue: 'LUAD',
              cellLineName: 'HCC-827',
              zScore: -2.8,
            }],
            tumorContext: {
              alteredSamples: 20,
              totalSamples: 100,
            },
            recommendedNextStep: {
              type: 'inspect-candidate',
            },
          },
          candidates: [{
            drugName: 'AFATINIB',
            maxClinicalStage: 'APPROVAL',
            drugType: 'Small molecule',
            ranking: { score: 12.4 },
          }],
          tumorStudy: { studyId: 'luad', mutationFrequencyPct: 20 },
        },
      },
    }]);

    expect(table).not.toBeNull();
    expect(table!.headers).toContain('topDrugName');
    expect(table!.headers).toContain('topFinding');
    expect(table!.headers).toContain('topSummaryReasons');
    expect(table!.headers).toContain('topSensitivityDrugName');
    expect(table!.rows[0].targetSymbol).toBe('EGFR');
    expect(table!.rows[0].topDrugName).toBe('AFATINIB');
    expect(table!.rows[0].matchedDisease).toBe('lung');
    expect(table!.rows[0].topSummaryReasons).toBe('disease match;approval-stage evidence');
    expect(table!.rows[0].topSensitivityDrugName).toBe('AFATINIB');
    expect(table!.rows[0].tumorStudyId).toBe('luad');
  });

  it('flattens aggregate/tumor-gene-dossier results into summary rows', () => {
    const table = flattenBatchSuccesses('aggregate/tumor-gene-dossier', [{
      input: 'TP53',
      index: 0,
      attempts: 1,
      succeededAt: '2026-04-13T00:00:00.000Z',
      result: {
        query: 'TP53 @ study',
        organism: 'human',
        completeness: 'complete',
        queriedAt: '2026-04-13T00:00:00.000Z',
        sources: ['NCBI Gene', 'cBioPortal'],
        warnings: [],
        ids: { ncbiGeneId: '7157', uniprotAccession: 'P04637', cbioportalStudyId: 'study' },
        data: {
          symbol: 'TP53',
          name: 'tumor protein p53',
          literature: [{ pmid: '36766853' }],
          agentSummary: {
            topFinding: 'TP53 is altered in 30% of the cohort and co-occurs with EGFR.',
            topCoMutations: [{
              partnerGene: 'EGFR',
              coMutationRateInAnchorPct: 100,
              contextTag: 'known_driver',
            }],
            exemplarVariants: [{
              proteinChange: 'R248Q',
              mutationType: 'Missense_Mutation',
            }],
            recommendedNextStep: {
              type: 'inspect-cohort-context',
            },
          },
          tumor: {
            studyId: 'study',
            alterationStatus: 'altered',
            alteredSamples: 3,
            totalSamples: 10,
            mutationEvents: 4,
            mutationFrequencyPct: 30,
            exemplarVariants: [{ proteinChange: 'R248Q' }],
            coMutations: [{
              partnerGene: 'EGFR',
              coMutationRateInAnchorPct: 100,
            }],
          },
        },
      },
    }]);

    expect(table).not.toBeNull();
    expect(table!.headers).toContain('studyId');
    expect(table!.headers).toContain('topFinding');
    expect(table!.headers).toContain('topCoMutationContextTag');
    expect(table!.headers).toContain('topVariantProteinChange');
    expect(table!.rows[0].symbol).toBe('TP53');
    expect(table!.rows[0].studyId).toBe('study');
    expect(table!.rows[0].topCoMutationGene).toBe('EGFR');
    expect(table!.rows[0].topCoMutationContextTag).toBe('known_driver');
    expect(table!.rows[0].topVariantProteinChange).toBe('R248Q');
  });
});
