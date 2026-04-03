import { describe, expect, it } from 'vitest';
import { getRegistry } from '../../registry.js';
import type { HttpContext } from '../../types.js';
import './search.js';

const ESEARCH_RESULT = {
  esearchresult: {
    count: '1',
    idlist: ['12345'],
  },
};

const ESUMMARY_RESULT = {
  result: {
    uids: ['12345'],
    '12345': {
      expxml: '<Summary><Title>RNA-seq of human liver</Title><Platform instrument_model="Illumina NovaSeq 6000"/><Organism taxname="Homo sapiens"/></Summary>',
      runs: '<Run acc="SRR12345678" total_spots="50000000" total_bases="7500000000"/>',
      total_runs: '1',
      createdate: '2023/04/01',
    },
  },
};

function makeCtx(): HttpContext {
  return {
    databaseId: 'sra',
    fetch: async () => { throw new Error('unexpected'); },
    fetchXml: async () => { throw new Error('unexpected'); },
    fetchText: async () => { throw new Error('unexpected'); },
    fetchJson: async (url: string) => {
      if (url.includes('esearch.fcgi') && url.includes('db=sra')) {
        return ESEARCH_RESULT;
      }
      if (url.includes('esummary.fcgi') && url.includes('db=sra')) {
        return ESUMMARY_RESULT;
      }
      throw new Error(`Unexpected fetchJson: ${url}`);
    },
  };
}

describe('sra/search adapter', () => {
  it('extracts metadata from embedded XML in SRA esummary', async () => {
    const cmd = getRegistry().get('sra/search');
    expect(cmd?.func).toBeTypeOf('function');

    const result = await cmd!.func!(makeCtx(), { query: 'RNA-seq human liver', limit: 10 });
    const rows = Array.isArray(result) ? result : (result as any).rows;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual(expect.objectContaining({
      accession: 'SRR12345678',
      title: 'RNA-seq of human liver',
      platform: 'Illumina NovaSeq 6000',
      organism: 'Homo sapiens',
    }));
  });
});
