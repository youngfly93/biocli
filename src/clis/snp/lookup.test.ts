import { describe, expect, it } from 'vitest';
import { getRegistry } from '../../registry.js';
import type { HttpContext } from '../../types.js';
import './lookup.js';

const SNP_SUMMARY = {
  result: {
    uids: ['334'],
    '334': {
      snp_id: 334,
      genes: [{ name: 'HBB', gene_id: 3043 }],
      chrpos: '11:5227002',
      docsum: 'T>A',
      global_mafs: [
        { study: 'GnomAD', freq: 'A=0.0549' },
      ],
      clinical_significance: ['pathogenic'],
      fxn_class: ['missense'],
    },
  },
};

function makeCtx(): HttpContext {
  return {
    databaseId: 'snp',
    fetch: async () => { throw new Error('unexpected'); },
    fetchXml: async () => { throw new Error('unexpected'); },
    fetchText: async () => { throw new Error('unexpected'); },
    fetchJson: async (url: string) => {
      if (url.includes('esummary.fcgi') && url.includes('db=snp')) {
        return SNP_SUMMARY;
      }
      throw new Error(`Unexpected fetchJson: ${url}`);
    },
  };
}

describe('snp/lookup adapter', () => {
  it('parses SNP esummary into expected fields', async () => {
    const cmd = getRegistry().get('snp/lookup');
    expect(cmd?.func).toBeTypeOf('function');

    const rows = await cmd!.func!(makeCtx(), { rsid: 'rs334' });
    expect(rows).toHaveLength(1);
    expect(rows).toEqual([
      expect.objectContaining({
        rsid: 'rs334',
        gene: 'HBB',
        chromosome: '11',
        position: '5227002',
        alleles: 'T>A',
        clinical: 'pathogenic',
        function: 'missense',
      }),
    ]);
  });
});
