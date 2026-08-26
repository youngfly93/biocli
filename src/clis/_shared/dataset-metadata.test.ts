import { describe, expect, it } from 'vitest';
import type { HttpContext } from '../../types.js';
import { fetchSraRunMetadata } from './dataset-metadata.js';

function buildSraContext(): HttpContext {
  return {
    databaseId: 'ncbi',
    fetch: async () => { throw new Error('unexpected fetch'); },
    fetchText: async () => { throw new Error('unexpected fetchText'); },
    fetchXml: async () => { throw new Error('unexpected fetchXml'); },
    fetchJson: async (url: string) => {
      if (url.includes('esearch.fcgi')) {
        return { esearchresult: { idlist: ['9001'] } };
      }
      return {
        result: {
          uids: ['9001'],
          '9001': {
            expxml: '<Summary><Title>Experiment query</Title><LibraryLayout><SINGLE/></LibraryLayout></Summary>',
            runs: '<Run acc="SRR9001"/>',
          },
        },
      };
    },
  };
}

describe('shared dataset metadata', () => {
  it('preserves sra/run experiment queries while allowing workflows to require an exact run', async () => {
    await expect(fetchSraRunMetadata(buildSraContext(), 'SRX9001')).resolves.toMatchObject({
      accession: 'SRR9001',
      title: 'Experiment query',
      layout: 'SINGLE',
    });
    await expect(fetchSraRunMetadata(buildSraContext(), 'SRX9001', { requireExactRun: true }))
      .rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});
