import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { getRegistry } from '../../registry.js';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const { createHttpContextForDatabaseMock } = vi.hoisted(() => ({
  createHttpContextForDatabaseMock: vi.fn(),
}));

vi.mock('../../databases/index.js', async (importOriginal) => {
  const actual = await importOriginal() as Record<string, unknown>;
  return {
    ...actual,
    createHttpContextForDatabase: createHttpContextForDatabaseMock,
  };
});

import './workflow-prepare.js';

const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = mkdtempSync(resolve(tmpdir(), 'biocli-wp-test-'));
  tempDirs.push(dir);
  return dir;
}

function buildNcbiContext() {
  return {
    databaseId: 'ncbi',
    fetch: async () => { throw new Error('unexpected'); },
    fetchXml: async () => { throw new Error('unexpected'); },
    fetchJson: async (url: string) => {
      if (url.includes('esearch.fcgi') && url.includes('db=gene')) {
        return { esearchresult: { idlist: ['7157'], count: '1' } };
      }
      if (url.includes('esummary.fcgi') && url.includes('db=gene')) {
        return {
          result: {
            uids: ['7157'],
            '7157': {
              uid: '7157', name: 'TP53', description: 'tumor protein p53',
              chromosome: '17', summary: 'Tumor suppressor.',
            },
          },
        };
      }
      throw new Error(`Unexpected ncbi fetchJson: ${url}`);
    },
    fetchText: async () => '<a href="test_data.csv.gz">test_data.csv.gz</a>  2024-01-01 12:00  100K',
  };
}

function buildUniprotContext() {
  return {
    databaseId: 'uniprot',
    fetch: async () => { throw new Error('unexpected'); },
    fetchXml: async () => { throw new Error('unexpected'); },
    fetchText: async () => { throw new Error('unexpected'); },
    fetchJson: async () => ({
      results: [{
        primaryAccession: 'P04637',
        genes: [{ geneName: { value: 'TP53' } }],
      }],
    }),
  };
}

function buildKeggContext() {
  return {
    databaseId: 'kegg',
    fetch: async () => { throw new Error('unexpected'); },
    fetchXml: async () => { throw new Error('unexpected'); },
    fetchJson: async () => { throw new Error('unexpected'); },
    fetchText: async () => 'hsa:7157\tpath:hsa04115\nhsa:7157\tpath:hsa05200',
  };
}

describe('aggregate/workflow-prepare', () => {
  beforeEach(() => {
    createHttpContextForDatabaseMock.mockReset();
    createHttpContextForDatabaseMock.mockImplementation((dbId: string) => {
      switch (dbId) {
        case 'ncbi': return buildNcbiContext();
        case 'uniprot': return buildUniprotContext();
        case 'kegg': return buildKeggContext();
        default: throw new Error(`Unexpected database: ${dbId}`);
      }
    });
  });

  afterEach(() => {
    while (tempDirs.length > 0) {
      const dir = tempDirs.pop();
      if (dir) rmSync(dir, { recursive: true, force: true });
    }
  });

  it('creates directory structure with annotations and manifest', async () => {
    const cmd = getRegistry().get('aggregate/workflow-prepare');
    expect(cmd?.func).toBeTypeOf('function');

    const outdir = join(makeTempDir(), 'project');
    const result = await cmd!.func!({} as any, {
      dataset: 'GSE99999',
      gene: 'TP53',
      outdir,
      'skip-download': true,
    }) as Record<string, unknown>;

    // Check directory structure
    expect(existsSync(join(outdir, 'manifest.json'))).toBe(true);
    expect(existsSync(join(outdir, 'annotations', 'genes.json'))).toBe(true);
    expect(existsSync(join(outdir, 'annotations', 'pathways.json'))).toBe(true);

    // Check genes.json content
    const genes = JSON.parse(readFileSync(join(outdir, 'annotations', 'genes.json'), 'utf-8'));
    expect(genes[0].symbol).toBe('TP53');
    expect(genes[0].ncbiGeneId).toBe('7157');
    expect(genes[0].uniprotAccession).toBe('P04637');

    // Check pathways.json
    const pathways = JSON.parse(readFileSync(join(outdir, 'annotations', 'pathways.json'), 'utf-8'));
    expect(pathways.length).toBe(2);

    // Check manifest consistency — steps in manifest match steps in result
    const manifest = JSON.parse(readFileSync(join(outdir, 'manifest.json'), 'utf-8'));
    const resultData = result.data as Record<string, unknown>;
    const resultSteps = resultData.steps as Record<string, unknown>[];
    expect(manifest.steps.length).toBe(resultSteps.length);

    // Check sources
    expect(result.sources).toContain('NCBI Gene');
    expect(result.sources).toContain('UniProt');
    expect(result.sources).toContain('KEGG');
  });
});
