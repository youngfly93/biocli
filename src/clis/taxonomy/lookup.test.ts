import { describe, expect, it } from 'vitest';
import { getRegistry } from '../../registry.js';
import type { HttpContext } from '../../types.js';
import './lookup.js';

const ESEARCH_RESULT = {
  esearchresult: {
    count: '1',
    idlist: ['9606'],
  },
};

const TAXONOMY_XML = {
  TaxaSet: {
    Taxon: {
      TaxId: '9606',
      ScientificName: 'Homo sapiens',
      OtherNames: { CommonName: 'human', GenbankCommonName: 'human' },
      Rank: 'species',
      Division: 'Primates',
      Lineage: 'Eukaryota; Metazoa; Chordata; Mammalia; Primates; Hominidae; Homo',
    },
  },
};

function makeCtx(): HttpContext {
  return {
    databaseId: 'taxonomy',
    fetch: async () => { throw new Error('unexpected'); },
    fetchText: async () => { throw new Error('unexpected'); },
    fetchJson: async (url: string) => {
      if (url.includes('esearch.fcgi') && url.includes('db=taxonomy')) {
        return ESEARCH_RESULT;
      }
      throw new Error(`Unexpected fetchJson: ${url}`);
    },
    fetchXml: async (url: string) => {
      if (url.includes('efetch.fcgi') && url.includes('db=taxonomy')) {
        return TAXONOMY_XML;
      }
      throw new Error(`Unexpected fetchXml: ${url}`);
    },
  };
}

describe('taxonomy/lookup adapter', () => {
  it('parses taxonomy esearch+efetch(XML) for name input', async () => {
    const cmd = getRegistry().get('taxonomy/lookup');
    expect(cmd?.func).toBeTypeOf('function');

    const rows = await cmd!.func!(makeCtx(), { query: 'Homo sapiens', limit: 5 }) as Record<string, unknown>[];
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual(expect.objectContaining({
      taxId: '9606',
      name: 'Homo sapiens',
      commonName: 'human',
      rank: 'species',
      division: 'Primates',
    }));
    expect(rows[0].lineage).toContain('Homo');
  });

  it('skips esearch for numeric taxonomy ID', async () => {
    let esearchCalled = false;
    const ctx: HttpContext = {
      databaseId: 'taxonomy',
      fetch: async () => { throw new Error('unexpected'); },
      fetchText: async () => { throw new Error('unexpected'); },
      fetchJson: async () => {
        esearchCalled = true;
        throw new Error('should not call esearch for numeric ID');
      },
      fetchXml: async () => TAXONOMY_XML,
    };

    const cmd = getRegistry().get('taxonomy/lookup');
    const rows = await cmd!.func!(ctx, { query: '9606', limit: 5 }) as Record<string, unknown>[];
    expect(esearchCalled).toBe(false);
    expect(rows).toHaveLength(1);
    expect(rows[0].taxId).toBe('9606');
  });
});
