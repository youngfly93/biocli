import { describe, expect, it } from 'vitest';
import { getRegistry } from '../../registry.js';
import type { HttpContext } from '../../types.js';
import './studies.js';

function makeCtx(): HttpContext {
  return {
    databaseId: 'cbioportal',
    fetch: async () => { throw new Error('unexpected'); },
    fetchXml: async () => { throw new Error('unexpected'); },
    fetchText: async () => { throw new Error('unexpected'); },
    fetchJson: async (url: string) => {
      if (url.includes('/studies')) {
        return [
          {
            studyId: 'breast_msk_2018',
            name: 'Breast Cancer (MSK, Cancer Cell 2018)',
            cancerType: { name: 'Breast Cancer' },
            sequencedSampleCount: 1918,
            cnaSampleCount: 1918,
            publicStudy: true,
          },
        ];
      }
      throw new Error(`Unexpected fetchJson: ${url}`);
    },
  };
}

describe('cbioportal/studies adapter', () => {
  it('parses study search results into table rows', async () => {
    const cmd = getRegistry().get('cbioportal/studies');
    expect(cmd?.func).toBeTypeOf('function');

    const result = await cmd!.func!(makeCtx(), { keyword: 'breast', limit: 5 });
    const rows = Array.isArray(result) ? result : (result as any).rows;

    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual(expect.objectContaining({
      studyId: 'breast_msk_2018',
      cancerType: 'Breast Cancer',
      sequencedSampleCount: 1918,
    }));
  });
});
