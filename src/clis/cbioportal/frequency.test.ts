import { describe, expect, it } from 'vitest';
import { getRegistry } from '../../registry.js';
import type { HttpContext } from '../../types.js';
import './frequency.js';

function makeCtx(): HttpContext {
  return {
    databaseId: 'cbioportal',
    fetch: async () => { throw new Error('unexpected'); },
    fetchXml: async () => { throw new Error('unexpected'); },
    fetchText: async () => { throw new Error('unexpected'); },
    fetchJson: async (url: string) => {
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
      if (url.includes('/mutations/fetch') && url.includes('pageNumber=0')) {
        return [
          {
            sampleId: 'S1',
            patientId: 'P1',
            mutationType: 'Missense_Mutation',
            proteinChange: 'R273C',
          },
          {
            sampleId: 'S2',
            patientId: 'P2',
            mutationType: 'Frame_Shift_Del',
            proteinChange: 'H168Cfs*8',
          },
        ];
      }
      if (url.includes('/mutations/fetch') && url.includes('pageNumber=1')) {
        return [
          {
            sampleId: 'S2',
            patientId: 'P2',
            mutationType: 'Missense_Mutation',
            proteinChange: 'R273C',
          },
          {
            sampleId: 'S3',
            patientId: 'P3',
            mutationType: 'Missense_Mutation',
            proteinChange: 'R248Q',
          },
        ];
      }
      if (url.includes('/mutations/fetch') && url.includes('pageNumber=2')) {
        return [];
      }
      throw new Error(`Unexpected fetchJson: ${url}`);
    },
  };
}

describe('cbioportal/frequency adapter', () => {
  it('computes mutation prevalence and paginates until exhaustion', async () => {
    const cmd = getRegistry().get('cbioportal/frequency');
    expect(cmd?.func).toBeTypeOf('function');

    const result = await cmd!.func!(makeCtx(), {
      gene: 'TP53',
      study: 'study',
      'page-size': 2,
    });
    const rows = Array.isArray(result) ? result : (result as any).rows;

    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual(expect.objectContaining({
      gene: 'TP53',
      totalSamples: 10,
      mutatedSamples: 3,
      uniquePatients: 3,
      mutationEvents: 4,
      mutationFrequency: 0.3,
      mutationFrequencyPct: 30,
      sampleListId: 'study_sequenced',
    }));
    expect(rows[0].topMutationTypes[0]).toEqual({
      mutationType: 'Missense_Mutation',
      count: 3,
    });
  });
});
