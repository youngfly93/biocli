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

function buildNcbiContext(options: { missingDataset?: boolean } = {}) {
  return {
    databaseId: 'ncbi',
    fetch: async () => { throw new Error('unexpected'); },
    fetchXml: async () => { throw new Error('unexpected'); },
    fetchJson: async (url: string) => {
      if (url.includes('esearch.fcgi') && url.includes('db=gds')) {
        return { esearchresult: { idlist: options.missingDataset ? [] : ['200099999'], count: options.missingDataset ? '0' : '1' } };
      }
      if (url.includes('esummary.fcgi') && url.includes('db=gds')) {
        return {
          result: {
            uids: ['200099999'],
            '200099999': {
              accession: 'GSE99999', title: 'TP53 perturbation expression study',
              taxon: 'Homo sapiens', entrytype: 'GSE', gpl: 'GPL9999',
              n_samples: 12, summary: 'A mock GEO series.', pdat: '2026-08-01',
            },
          },
        };
      }
      if (url.includes('esearch.fcgi') && url.includes('db=sra')) {
        return { esearchresult: { idlist: options.missingDataset ? [] : ['900123456'], count: options.missingDataset ? '0' : '1' } };
      }
      if (url.includes('esummary.fcgi') && url.includes('db=sra')) {
        return {
          result: {
            uids: ['900123456'],
            '900123456': {
              expxml: '<Summary><Title>Mock RNA-seq run</Title><Platform instrument_model="Illumina NovaSeq 6000"/><Organism taxname="Homo sapiens"/><Library_strategy>RNA-Seq</Library_strategy><Library_source>TRANSCRIPTOMIC</Library_source><LibraryLayout><PAIRED/></LibraryLayout></Summary>',
              runs: '<Run acc="SRR123456"/>',
              createdate: '2026-08-01',
            },
          },
        };
      }
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
    expect(existsSync(join(outdir, 'metadata', 'dataset.json'))).toBe(true);
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

    const datasetMetadata = JSON.parse(readFileSync(join(outdir, 'metadata', 'dataset.json'), 'utf-8'));
    expect(datasetMetadata).toMatchObject({
      source: 'GEO',
      accession: 'GSE99999',
      ncbiUid: '200099999',
      organism: 'Homo sapiens',
      samples: 12,
    });
    expect(datasetMetadata.validatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    // Check manifest consistency — steps in manifest match steps in result
    const manifest = JSON.parse(readFileSync(join(outdir, 'manifest.json'), 'utf-8'));
    const resultData = result.data as Record<string, unknown>;
    const resultSteps = resultData.steps as Record<string, unknown>[];
    expect(manifest.steps.length).toBe(resultSteps.length);
    expect(manifest.datasetMetadata).toBe('metadata/dataset.json');
    expect(manifest.directories.metadata).toBe('metadata/');

    // Check sources
    expect(result.sources).toContain('GEO');
    expect(result.sources).toContain('NCBI Gene');
    expect(result.sources).toContain('UniProt');
    expect(result.sources).toContain('KEGG');
  });

  it('validates an SRA run and persists its metadata without downloading FASTQ', async () => {
    const cmd = getRegistry().get('aggregate/workflow-prepare');
    const outdir = join(makeTempDir(), 'sra-project');

    const result = await cmd!.func!({} as any, {
      dataset: 'SRR123456',
      outdir,
      'skip-download': true,
    }) as Record<string, unknown>;

    const metadata = JSON.parse(readFileSync(join(outdir, 'metadata', 'dataset.json'), 'utf-8'));
    expect(metadata).toMatchObject({
      source: 'SRA',
      accession: 'SRR123456',
      ncbiUid: '900123456',
      organism: 'Homo sapiens',
      strategy: 'RNA-Seq',
      librarySource: 'TRANSCRIPTOMIC',
      layout: 'PAIRED',
    });
    expect(result.sources).toEqual(['SRA']);
    expect(result.completeness).toBe('complete');
  });

  it('rejects a nonexistent accession before creating the output directory', async () => {
    createHttpContextForDatabaseMock.mockImplementation((dbId: string) => {
      if (dbId === 'ncbi') return buildNcbiContext({ missingDataset: true });
      throw new Error(`Unexpected database: ${dbId}`);
    });
    const cmd = getRegistry().get('aggregate/workflow-prepare');
    const outdir = join(makeTempDir(), 'must-not-exist');

    await expect(cmd!.func!({} as any, {
      dataset: 'GSE999999999',
      outdir,
      'skip-download': true,
    })).rejects.toMatchObject({
      code: 'NOT_FOUND',
      message: 'GEO entry GSE999999999 not found',
    });
    expect(existsSync(outdir)).toBe(false);
  });
});
