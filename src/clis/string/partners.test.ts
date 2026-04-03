import { describe, expect, it } from 'vitest';
import { getRegistry } from '../../registry.js';
import type { HttpContext } from '../../types.js';
import './partners.js';

const STRING_PARTNERS = [
  {
    preferredName_A: 'TP53',
    preferredName_B: 'MDM2',
    score: 0.999,
    escore: 0.8,
    dscore: 0.9,
  },
  {
    preferredName_A: 'TP53',
    preferredName_B: 'CDKN1A',
    score: 0.998,
    escore: 0.7,
    dscore: 0.85,
  },
];

function makeCtx(): HttpContext {
  return {
    databaseId: 'string',
    fetch: async () => { throw new Error('unexpected'); },
    fetchXml: async () => { throw new Error('unexpected'); },
    fetchText: async () => { throw new Error('unexpected'); },
    fetchJson: async (url: string) => {
      if (url.includes('interaction_partners')) {
        return STRING_PARTNERS;
      }
      throw new Error(`Unexpected fetchJson: ${url}`);
    },
  };
}

describe('string/partners adapter', () => {
  it('parses STRING interaction partners', async () => {
    const cmd = getRegistry().get('string/partners');
    expect(cmd?.func).toBeTypeOf('function');

    const result = await cmd!.func!(makeCtx(), { protein: 'TP53', limit: 10, species: 9606, score: 400 });
    const rows = Array.isArray(result) ? result : (result as any).rows;
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual(expect.objectContaining({
      partnerA: 'TP53',
      partnerB: 'MDM2',
      score: 0.999,
      experimentalScore: 0.8,
      databaseScore: 0.9,
    }));
  });
});
