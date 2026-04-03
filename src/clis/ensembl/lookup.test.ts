import { describe, expect, it } from 'vitest';
import { getRegistry } from '../../registry.js';
import type { HttpContext } from '../../types.js';
import './lookup.js';

const ENSEMBL_LOOKUP = {
  id: 'ENSG00000141510',
  display_name: 'TP53',
  biotype: 'protein_coding',
  seq_region_name: '17',
  start: 7661779,
  end: 7687538,
  strand: -1,
  description: 'tumor protein p53 [Source:HGNC Symbol;Acc:HGNC:11998]',
};

function makeCtx(): HttpContext {
  return {
    databaseId: 'ensembl',
    fetch: async () => { throw new Error('unexpected'); },
    fetchXml: async () => { throw new Error('unexpected'); },
    fetchText: async () => { throw new Error('unexpected'); },
    fetchJson: async (url: string) => {
      if (url.includes('/lookup/symbol/')) {
        return ENSEMBL_LOOKUP;
      }
      throw new Error(`Unexpected fetchJson: ${url}`);
    },
  };
}

describe('ensembl/lookup adapter', () => {
  it('parses Ensembl lookup response', async () => {
    const cmd = getRegistry().get('ensembl/lookup');
    expect(cmd?.func).toBeTypeOf('function');

    const rows = await cmd!.func!(makeCtx(), { symbol: 'TP53', species: 'homo_sapiens' });
    expect(rows).toHaveLength(1);
    expect(rows).toEqual([
      expect.objectContaining({
        ensemblId: 'ENSG00000141510',
        symbol: 'TP53',
        biotype: 'protein_coding',
        chromosome: '17',
        start: 7661779,
        end: 7687538,
        strand: '-',
        description: 'tumor protein p53',
      }),
    ]);
  });
});
