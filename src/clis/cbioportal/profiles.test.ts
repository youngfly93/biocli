import { describe, expect, it } from 'vitest';
import { getRegistry } from '../../registry.js';
import type { HttpContext } from '../../types.js';
import './profiles.js';

function makeCtx(): HttpContext {
  return {
    databaseId: 'cbioportal',
    fetch: async () => { throw new Error('unexpected'); },
    fetchXml: async () => { throw new Error('unexpected'); },
    fetchText: async () => { throw new Error('unexpected'); },
    fetchJson: async (url: string) => {
      if (url.includes('/molecular-profiles')) {
        return [
          {
            molecularProfileId: 'study_mutations',
            molecularAlterationType: 'MUTATION_EXTENDED',
            datatype: 'MAF',
            studyId: 'study',
            name: 'Mutations',
          },
          {
            molecularProfileId: 'study_rna',
            molecularAlterationType: 'MRNA_EXPRESSION',
            datatype: 'CONTINUOUS',
            studyId: 'study',
            name: 'mRNA',
          },
        ];
      }
      throw new Error(`Unexpected fetchJson: ${url}`);
    },
  };
}

describe('cbioportal/profiles adapter', () => {
  it('lists molecular profiles and supports type filtering', async () => {
    const cmd = getRegistry().get('cbioportal/profiles');
    expect(cmd?.func).toBeTypeOf('function');

    const result = await cmd!.func!(makeCtx(), { study: 'study', type: 'mutation_extended', limit: 10 });
    const rows = Array.isArray(result) ? result : (result as any).rows;

    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual(expect.objectContaining({
      molecularProfileId: 'study_mutations',
      molecularAlterationType: 'MUTATION_EXTENDED',
    }));
  });
});
