import { describe, expect, it } from 'vitest';
import { getRegistry } from '../../registry.js';
import type { HttpContext } from '../../types.js';
import './pathway.js';

const KEGG_ENTRY_TEXT = `ENTRY       hsa04115                    Pathway
NAME        p53 signaling pathway - Homo sapiens (human)
DESCRIPTION The p53 transcription factor responds to diverse stresses.
CLASS       Human Diseases; Cancer
GENE        7157  TP53; tumor protein p53
            1111  CHEK1; checkpoint kinase 1
DISEASE     H00004  Chronic myeloid leukemia
///`;

function makeCtx(): HttpContext {
  return {
    databaseId: 'kegg',
    fetch: async () => { throw new Error('unexpected'); },
    fetchXml: async () => { throw new Error('unexpected'); },
    fetchJson: async () => { throw new Error('unexpected'); },
    fetchText: async (url: string) => {
      if (url.includes('/get/hsa04115')) {
        return KEGG_ENTRY_TEXT;
      }
      throw new Error(`Unexpected fetchText: ${url}`);
    },
  };
}

describe('kegg/pathway adapter', () => {
  it('parses KEGG flat-file pathway entry', async () => {
    const cmd = getRegistry().get('kegg/pathway');
    expect(cmd?.func).toBeTypeOf('function');

    const rows = await cmd!.func!(makeCtx(), { id: 'hsa04115' }) as Record<string, unknown>[];
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual(expect.objectContaining({
      id: 'hsa04115',
      name: expect.stringContaining('p53 signaling pathway'),
      description: expect.stringContaining('p53 transcription factor'),
      class: expect.stringContaining('Cancer'),
    }));
  });
});
