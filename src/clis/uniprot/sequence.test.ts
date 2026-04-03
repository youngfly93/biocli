import { describe, expect, it } from 'vitest';
import { getRegistry } from '../../registry.js';
import type { HttpContext } from '../../types.js';
import './sequence.js';

const FASTA_TEXT = `>sp|P04637|P53_HUMAN Cellular tumor antigen p53 OS=Homo sapiens OX=9606 GN=TP53 PE=1 SV=4
MEEPQSDPSVEPPLSQETFSDLWKLLPENNVLSPLPSQAMDDLMLSPDDIEQWFTEDPG
PDEAPRMPEAAPPVAPAPAAPTPAAPAPAPSWPLSSSVPSQK`;

function makeCtx(): HttpContext {
  return {
    databaseId: 'uniprot',
    fetch: async () => { throw new Error('unexpected'); },
    fetchXml: async () => { throw new Error('unexpected'); },
    fetchJson: async () => { throw new Error('unexpected'); },
    fetchText: async (url: string) => {
      if (url.includes('/uniprotkb/P04637.fasta')) return FASTA_TEXT;
      throw new Error(`Unexpected fetchText: ${url}`);
    },
  };
}

describe('uniprot/sequence adapter', () => {
  it('downloads FASTA from UniProt', async () => {
    const cmd = getRegistry().get('uniprot/sequence');
    expect(cmd?.func).toBeTypeOf('function');

    const rows = await cmd!.func!(makeCtx(), { accession: 'P04637' }) as Record<string, unknown>[];
    expect(rows).toHaveLength(1);
    expect(String(rows[0].content)).toContain('>sp|P04637');
    expect(String(rows[0].content)).toContain('MEEPQSDP');
  });
});
