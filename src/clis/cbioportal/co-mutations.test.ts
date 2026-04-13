import { describe, expect, it } from 'vitest';
import { getRegistry } from '../../registry.js';
import type { FetchOptions, HttpContext } from '../../types.js';
import './co-mutations.js';

function makeCtx(): HttpContext {
  return {
    databaseId: 'cbioportal',
    fetch: async () => { throw new Error('unexpected'); },
    fetchXml: async () => { throw new Error('unexpected'); },
    fetchText: async () => { throw new Error('unexpected'); },
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
        // Anchor gene fetch (TP53 by gene ID + sampleListId)
        if (body.entrezGeneIds?.includes(7157) && !body.sampleIds && url.includes('pageNumber=0')) {
          return [
            { sampleId: 'S1', patientId: 'P1' },
            { sampleId: 'S2', patientId: 'P2' },
            { sampleId: 'S2', patientId: 'P2' },
          ];
        }
        if (body.entrezGeneIds?.includes(7157) && !body.sampleIds && url.includes('pageNumber=1')) {
          return [{ sampleId: 'S3', patientId: 'P3' }];
        }
        // Co-mutation batched fetch (sampleIds + entrezGeneIds batches)
        // Only return partner mutations on page 0 for batches that include mock genes
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
            { entrezGeneId: 5290, hugoGeneSymbol: 'PIK3CA', mutations: [
              { sampleId: 'S3', patientId: 'P3', mutationType: 'Missense_Mutation', proteinChange: 'H1047R' },
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
        // Legacy: sampleIds without entrezGeneIds (should not happen with new code, but keep for safety)
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
              { sampleId: 'S3', patientId: 'P3', gene: { entrezGeneId: 5290, hugoGeneSymbol: 'PIK3CA' }, mutationType: 'Missense_Mutation', proteinChange: 'H1047R' },
              { sampleId: 'S3', patientId: 'P3', gene: { entrezGeneId: 1956, hugoGeneSymbol: 'EGFR' }, mutationType: 'Amplification', proteinChange: '' },
              { sampleId: 'S3', patientId: 'P3', gene: { entrezGeneId: 672, hugoGeneSymbol: 'BRCA1' }, mutationType: 'Frame_Shift_Del', proteinChange: 'S1140fs' },
            ];
          }
          if (url.includes('pageNumber=2')) return [];
        }
      }
      throw new Error(`Unexpected fetchJson: ${url}`);
    },
  };
}

describe('cbioportal/co-mutations adapter', () => {
  it('discovers partner genes inside the anchor-mutated cohort and ranks them', async () => {
    const cmd = getRegistry().get('cbioportal/co-mutations');
    expect(cmd?.func).toBeTypeOf('function');

    const result = await cmd!.func!(makeCtx(), {
      gene: 'TP53',
      study: 'study',
      limit: 5,
      'min-samples': 2,
      'page-size': 3,
    });
    const rows = Array.isArray(result) ? result : (result as any).rows;

    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual(expect.objectContaining({
      anchorGene: 'TP53',
      partnerGene: 'EGFR',
      partnerEntrezGeneId: 1956,
      totalSamples: 10,
      anchorMutatedSamples: 3,
      coMutatedSamples: 3,
      partnerPatients: 3,
      partnerMutationEvents: 3,
      coMutationRateInAnchorPct: 100,
      coMutationFrequencyInStudyPct: 30,
    }));
    expect(rows[0].topMutationTypes[0]).toEqual({
      mutationType: 'Missense_Mutation',
      count: 2,
    });
    expect(rows[1]).toEqual(expect.objectContaining({
      partnerGene: 'BRCA1',
      coMutatedSamples: 2,
      partnerMutationEvents: 2,
      coMutationRateInAnchorPct: 66.67,
    }));
  });
});
