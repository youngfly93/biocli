import { beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { FetchOptions, HttpContext } from '../../types.js';
import { getRegistry } from '../../registry.js';

const { createHttpContextForDatabaseMock } = vi.hoisted(() => ({
  createHttpContextForDatabaseMock: vi.fn(),
}));

vi.mock('../../databases/index.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../databases/index.js')>();
  return {
    ...actual,
    createHttpContextForDatabase: createHttpContextForDatabaseMock,
  };
});

import '../../clis/aggregate/gene-profile.js';

function unexpected(name: string) {
  return async () => {
    throw new Error(`Unexpected call to ${name}`);
  };
}

function buildNcbiContext(): HttpContext {
  return {
    databaseId: 'ncbi',
    fetch: unexpected('ncbi.fetch'),
    fetchText: unexpected('ncbi.fetchText'),
    fetchXml: unexpected('ncbi.fetchXml'),
    fetchJson: async (url: string) => {
      if (url.includes('esearch.fcgi') && url.includes('TP53')) {
        return { esearchresult: { idlist: ['7157'] } };
      }
      if (url.includes('esearch.fcgi') && url.includes('BRCA1')) {
        return { esearchresult: { idlist: ['672'] } };
      }
      if (url.includes('esummary.fcgi') && url.includes('7157')) {
        return {
          result: {
            uids: ['7157'],
            '7157': {
              uid: '7157',
              name: 'TP53',
              description: 'tumor protein p53',
              organism: { scientificname: 'Homo sapiens' },
              chromosome: '17',
              maplocation: '17p13.1',
            },
          },
        };
      }
      if (url.includes('esummary.fcgi') && url.includes('672')) {
        return {
          result: {
            uids: ['672'],
            '672': {
              uid: '672',
              name: 'BRCA1',
              description: 'BRCA1 DNA repair associated',
              organism: { scientificname: 'Homo sapiens' },
              chromosome: '17',
              maplocation: '17q21.31',
            },
          },
        };
      }
      throw new Error(`Unhandled NCBI URL: ${url}`);
    },
  };
}

function buildUniprotContext(): HttpContext {
  return {
    databaseId: 'uniprot',
    fetch: unexpected('uniprot.fetch'),
    fetchText: unexpected('uniprot.fetchText'),
    fetchXml: unexpected('uniprot.fetchXml'),
    fetchJson: async (url: string) => {
      if (url.includes('gene%3ATP53')) {
        return {
          results: [{
            primaryAccession: 'P04637',
            genes: [{ geneName: { value: 'TP53' } }],
            comments: [{ commentType: 'FUNCTION', texts: [{ value: 'DNA damage checkpoint regulator.' }] }],
            uniProtKBCrossReferences: [],
          }],
        };
      }
      if (url.includes('gene%3ABRCA1')) {
        return {
          results: [{
            primaryAccession: 'P38398',
            genes: [{ geneName: { value: 'BRCA1' } }],
            comments: [{ commentType: 'FUNCTION', texts: [{ value: 'DNA repair scaffold.' }] }],
            uniProtKBCrossReferences: [],
          }],
        };
      }
      throw new Error(`Unhandled UniProt URL: ${url}`);
    },
  };
}

function buildKeggContext(): HttpContext {
  return {
    databaseId: 'kegg',
    fetch: unexpected('kegg.fetch'),
    fetchJson: unexpected('kegg.fetchJson'),
    fetchXml: unexpected('kegg.fetchXml'),
    fetchText: async (url: string, _opts?: FetchOptions) => {
      if (url.endsWith('/link/pathway/hsa:7157')) return 'hsa:7157\tpath:hsa04115\n';
      if (url.endsWith('/link/pathway/hsa:672')) return 'hsa:672\tpath:hsa03440\n';
      if (url.endsWith('/link/disease/hsa:7157') || url.endsWith('/link/disease/hsa:672')) return '';
      if (url.endsWith('/list/pathway/hsa')) {
        return [
          'path:hsa04115\tp53 signaling pathway - Homo sapiens (human)',
          'path:hsa03440\tHomologous recombination - Homo sapiens (human)',
          '',
        ].join('\n');
      }
      throw new Error(`Unhandled KEGG URL: ${url}`);
    },
  };
}

function buildStringContext(): HttpContext {
  return {
    databaseId: 'string',
    fetch: unexpected('string.fetch'),
    fetchText: unexpected('string.fetchText'),
    fetchXml: unexpected('string.fetchXml'),
    fetchJson: async () => [],
  };
}

describe('aggregate/gene-profile', () => {
  beforeEach(() => {
    createHttpContextForDatabaseMock.mockReset();
    createHttpContextForDatabaseMock.mockImplementation((databaseId: string) => {
      if (databaseId === 'ncbi') return buildNcbiContext();
      if (databaseId === 'uniprot') return buildUniprotContext();
      if (databaseId === 'kegg') return buildKeggContext();
      if (databaseId === 'string') return buildStringContext();
      throw new Error(`Unexpected database: ${databaseId}`);
    });
  });

  it('supports multi-gene batch execution through the shared batch runner', async () => {
    const cmd = getRegistry().get('aggregate/gene-profile');
    expect(cmd?.func).toBeTypeOf('function');

    const result = await cmd!.func!({} as HttpContext, {
      genes: 'TP53,BRCA1',
      organism: 'human',
      __batch: { concurrency: 2, retries: 0 },
    });

    expect(Array.isArray(result)).toBe(true);
    const rows = result as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(2);
    expect(rows[0].query).toBe('TP53');
    expect(rows[1].query).toBe('BRCA1');
  });

  it('writes batch artifacts when outdir is provided', async () => {
    const cmd = getRegistry().get('aggregate/gene-profile');
    const outdir = mkdtempSync(join(tmpdir(), 'biocli-gene-profile-batch-'));
    try {
      await cmd!.func!({} as HttpContext, {
        genes: 'TP53,BRCA1',
        organism: 'human',
        __batch: { concurrency: 2, retries: 0, outdir },
      });

      expect(existsSync(join(outdir, 'results.jsonl'))).toBe(true);
      expect(existsSync(join(outdir, 'failures.jsonl'))).toBe(true);
      expect(existsSync(join(outdir, 'summary.json'))).toBe(true);
      expect(existsSync(join(outdir, 'summary.csv'))).toBe(true);
      expect(existsSync(join(outdir, 'manifest.json'))).toBe(true);
      expect(existsSync(join(outdir, 'methods.md'))).toBe(true);

      const manifest = JSON.parse(readFileSync(join(outdir, 'manifest.json'), 'utf-8'));
      const summaryCsv = readFileSync(join(outdir, 'summary.csv'), 'utf-8');
      const methodsMd = readFileSync(join(outdir, 'methods.md'), 'utf-8');
      expect(manifest.command).toBe('aggregate/gene-profile');
      expect(manifest.inputSource).toBe('inline');
      expect(summaryCsv).toContain('TP53');
      expect(methodsMd).toContain('## Batch Run');
    } finally {
      rmSync(outdir, { recursive: true, force: true });
    }
  });
});
