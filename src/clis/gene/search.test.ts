import { describe, expect, it } from 'vitest';
import { getRegistry } from '../../registry.js';
import type { HttpContext } from '../../types.js';
import './search.js';

const ESEARCH_RESULT = {
  esearchresult: {
    count: '1',
    idlist: ['7157'],
  },
};

const ESUMMARY_RESULT = {
  result: {
    uids: ['7157'],
    '7157': {
      uid: '7157',
      name: 'TP53',
      description: 'tumor protein p53',
      organism: { scientificname: 'Homo sapiens' },
      summary: 'This gene encodes a tumor suppressor protein.',
      chromosome: '17',
      maplocation: '17p13.1',
    },
  },
};

function makeCtx(): HttpContext {
  return {
    databaseId: 'gene',
    fetch: async () => { throw new Error('unexpected'); },
    fetchXml: async () => { throw new Error('unexpected'); },
    fetchText: async () => { throw new Error('unexpected'); },
    fetchJson: async (url: string) => {
      if (url.includes('esearch.fcgi') && url.includes('db=gene')) {
        return ESEARCH_RESULT;
      }
      if (url.includes('esummary.fcgi') && url.includes('db=gene')) {
        return ESUMMARY_RESULT;
      }
      throw new Error(`Unexpected fetchJson: ${url}`);
    },
  };
}

describe('gene/search adapter', () => {
  it('parses gene esearch+esummary into expected fields', async () => {
    const cmd = getRegistry().get('gene/search');
    expect(cmd?.func).toBeTypeOf('function');

    const result = await cmd!.func!(makeCtx(), { query: 'TP53', limit: 10, organism: 'human' });
    const rows = Array.isArray(result) ? result : (result as any).rows;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual(expect.objectContaining({
      geneId: '7157',
      symbol: 'TP53',
      name: 'tumor protein p53',
      organism: 'Homo sapiens',
    }));
  });
});
