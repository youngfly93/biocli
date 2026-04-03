import { describe, expect, it } from 'vitest';
import { getRegistry } from '../../registry.js';
import type { HttpContext } from '../../types.js';
import './search.js';

const ESEARCH_RESULT = {
  esearchresult: {
    count: '1',
    idlist: ['37617'],
  },
};

const ESUMMARY_RESULT = {
  result: {
    uids: ['37617'],
    '37617': {
      title: 'NM_007294.4(BRCA1):c.5266dupC (p.Gln1756Profs*74)',
      clinical_significance: { description: 'Pathogenic' },
      genes: [{ symbol: 'BRCA1' }],
      trait_set: [{ trait_name: 'Hereditary breast and ovarian cancer syndrome' }],
      accession: 'VCV000037617',
    },
  },
};

function makeCtx(): HttpContext {
  return {
    databaseId: 'clinvar',
    fetch: async () => { throw new Error('unexpected'); },
    fetchXml: async () => { throw new Error('unexpected'); },
    fetchText: async () => { throw new Error('unexpected'); },
    fetchJson: async (url: string) => {
      if (url.includes('esearch.fcgi') && url.includes('db=clinvar')) {
        return ESEARCH_RESULT;
      }
      if (url.includes('esummary.fcgi') && url.includes('db=clinvar')) {
        return ESUMMARY_RESULT;
      }
      throw new Error(`Unexpected fetchJson: ${url}`);
    },
  };
}

describe('clinvar/search adapter', () => {
  it('parses ClinVar esearch+esummary into expected fields', async () => {
    const cmd = getRegistry().get('clinvar/search');
    expect(cmd?.func).toBeTypeOf('function');

    const result = await cmd!.func!(makeCtx(), { query: 'BRCA1', limit: 10 });
    const rows = Array.isArray(result) ? result : (result as any).rows;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual(expect.objectContaining({
      uid: '37617',
      gene: 'BRCA1',
      significance: 'Pathogenic',
      accession: 'VCV000037617',
    }));
    expect(rows[0].condition).toContain('Hereditary breast');
  });
});
