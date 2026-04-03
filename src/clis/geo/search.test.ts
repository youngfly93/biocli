import { describe, expect, it } from 'vitest';
import { getRegistry } from '../../registry.js';
import type { HttpContext } from '../../types.js';
import './search.js';

const ESEARCH_RESULT = {
  esearchresult: {
    count: '1',
    idlist: ['200100550'],
  },
};

const ESUMMARY_RESULT = {
  result: {
    uids: ['200100550'],
    '200100550': {
      accession: 'GSE100550',
      title: 'RNA-seq of breast cancer cell lines',
      taxon: 'Homo sapiens',
      entrytype: 'GSE',
      n_samples: 48,
      pdat: '2023/06/15',
    },
  },
};

function makeCtx(): HttpContext {
  return {
    databaseId: 'gds',
    fetch: async () => { throw new Error('unexpected'); },
    fetchXml: async () => { throw new Error('unexpected'); },
    fetchText: async () => { throw new Error('unexpected'); },
    fetchJson: async (url: string) => {
      if (url.includes('esearch.fcgi') && url.includes('db=gds')) {
        return ESEARCH_RESULT;
      }
      if (url.includes('esummary.fcgi') && url.includes('db=gds')) {
        return ESUMMARY_RESULT;
      }
      throw new Error(`Unexpected fetchJson: ${url}`);
    },
  };
}

describe('geo/search adapter', () => {
  it('parses GEO esearch+esummary into expected fields', async () => {
    const cmd = getRegistry().get('geo/search');
    expect(cmd?.func).toBeTypeOf('function');

    const result = await cmd!.func!(makeCtx(), { query: 'breast cancer', limit: 10, type: 'gse' });
    const rows = Array.isArray(result) ? result : (result as any).rows;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual(expect.objectContaining({
      accession: 'GSE100550',
      title: 'RNA-seq of breast cancer cell lines',
      organism: 'Homo sapiens',
      type: 'GSE',
      samples: 48,
    }));
  });
});
