import { describe, expect, it } from 'vitest';
import { getRegistry } from '../../registry.js';
import type { HttpContext } from '../../types.js';
import './mutations.js';

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
      if (url.includes('/molecular-profiles') && url.includes('/studies/')) {
        return [
          {
            molecularProfileId: 'study_mutations',
            molecularAlterationType: 'MUTATION_EXTENDED',
            datatype: 'MAF',
            studyId: 'study',
          },
        ];
      }
      if (url.includes('/sample-lists')) {
        return [
          {
            sampleListId: 'study_sequenced',
            category: 'all_cases_with_mutation_data',
            studyId: 'study',
          },
        ];
      }
      if (url.includes('/mutations/fetch')) {
        return [
          {
            sampleId: 'S1',
            patientId: 'P1',
            studyId: 'study',
            molecularProfileId: 'study_mutations',
            proteinChange: 'R273C',
            mutationType: 'Missense_Mutation',
            mutationStatus: 'Somatic',
            chr: '17',
            startPosition: 7577121,
            endPosition: 7577121,
            variantAllele: 'T',
            referenceAllele: 'C',
            tumorAltCount: 12,
            tumorRefCount: 24,
          },
        ];
      }
      throw new Error(`Unexpected fetchJson: ${url}`);
    },
  };
}

describe('cbioportal/mutations adapter', () => {
  it('resolves gene/profile/sample-list and parses mutation rows', async () => {
    const cmd = getRegistry().get('cbioportal/mutations');
    expect(cmd?.func).toBeTypeOf('function');

    const result = await cmd!.func!(makeCtx(), {
      gene: 'TP53',
      study: 'study',
      limit: 5,
    });
    const rows = Array.isArray(result) ? result : (result as any).rows;

    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual(expect.objectContaining({
      gene: 'TP53',
      entrezGeneId: 7157,
      sampleId: 'S1',
      proteinChange: 'R273C',
      mutationType: 'Missense_Mutation',
      sampleListId: 'study_sequenced',
    }));
  });
});
