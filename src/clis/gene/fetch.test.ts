import { describe, expect, it } from 'vitest';
import { getRegistry } from '../../registry.js';
import type { HttpContext } from '../../types.js';
import './fetch.js';

const ELINK_RESULT = {
  linksets: [{
    linksetdbs: [{
      links: ['1234567'],
    }],
  }],
};

const FASTA_TEXT = `>NM_000546.6 Homo sapiens tumor protein p53 (TP53), mRNA
ATGGAGGAGCCGCAGTCAGATCCTAGCGTGAGTTTGCACAAGTACCTGCCGTCCTGGAA
AATACCTATGCAATGAGC`;

function makeCtx(): HttpContext {
  return {
    databaseId: 'gene',
    fetch: async () => { throw new Error('unexpected'); },
    fetchXml: async () => { throw new Error('unexpected'); },
    fetchJson: async (url: string) => {
      if (url.includes('elink.fcgi')) return ELINK_RESULT;
      throw new Error(`Unexpected fetchJson: ${url}`);
    },
    fetchText: async (url: string) => {
      if (url.includes('efetch.fcgi') && url.includes('rettype=fasta')) return FASTA_TEXT;
      throw new Error(`Unexpected fetchText: ${url}`);
    },
  };
}

describe('gene/fetch adapter', () => {
  it('downloads nucleotide FASTA via elink + efetch', async () => {
    const cmd = getRegistry().get('gene/fetch');
    expect(cmd?.func).toBeTypeOf('function');

    const rows = await cmd!.func!(makeCtx(), { id: '7157', type: 'nucleotide' }) as Record<string, unknown>[];
    expect(rows).toHaveLength(1);
    expect(String(rows[0].content)).toContain('>NM_000546');
    expect(String(rows[0].content)).toContain('ATGGAGGAG');
  });
});
