import { describe, expect, it } from 'vitest';
import { getRegistry } from '../../registry.js';
import type { HttpContext } from '../../types.js';
import './fetch.js';

const UNIPROT_ENTRY = {
  primaryAccession: 'P04637',
  genes: [{
    geneName: { value: 'TP53' },
  }],
  proteinDescription: {
    recommendedName: {
      fullName: { value: 'Cellular tumor antigen p53' },
    },
  },
  organism: {
    scientificName: 'Homo sapiens',
  },
  comments: [
    {
      commentType: 'FUNCTION',
      texts: [{ value: 'Acts as a tumor suppressor.' }],
    },
    {
      commentType: 'SUBCELLULAR LOCATION',
      subcellularLocations: [
        { location: { value: 'Nucleus' } },
        { location: { value: 'Cytoplasm' } },
      ],
    },
  ],
  uniProtKBCrossReferences: [
    {
      database: 'GO',
      id: 'GO:0005634',
      properties: [{ key: 'GoTerm', value: 'C:nucleus' }],
    },
    {
      database: 'GO',
      id: 'GO:0003700',
      properties: [{ key: 'GoTerm', value: 'F:DNA-binding transcription factor activity' }],
    },
  ],
  features: [
    {
      type: 'Domain',
      description: 'Transactivation',
      location: { start: { value: 1 }, end: { value: 43 } },
    },
  ],
};

function makeCtx(): HttpContext {
  return {
    databaseId: 'uniprot',
    fetch: async () => { throw new Error('unexpected'); },
    fetchXml: async () => { throw new Error('unexpected'); },
    fetchText: async () => { throw new Error('unexpected'); },
    fetchJson: async (url: string) => {
      if (url.includes('/uniprotkb/P04637')) {
        return UNIPROT_ENTRY;
      }
      throw new Error(`Unexpected fetchJson: ${url}`);
    },
  };
}

describe('uniprot/fetch adapter', () => {
  it('parses UniProt entry into expected fields', async () => {
    const cmd = getRegistry().get('uniprot/fetch');
    expect(cmd?.func).toBeTypeOf('function');

    const rows = await cmd!.func!(makeCtx(), { accession: 'P04637' }) as Record<string, unknown>[];
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual(expect.objectContaining({
      accession: 'P04637',
      gene: 'TP53',
      protein: 'Cellular tumor antigen p53',
      organism: 'Homo sapiens',
      function: 'Acts as a tumor suppressor.',
      subcellularLocation: 'Nucleus, Cytoplasm',
    }));
    // Check GO terms and domains are populated
    expect(rows[0].goTerms).toContain('CC:nucleus');
    expect(rows[0].domains).toContain('Transactivation');
  });
});
