import { describe, expect, it, vi, beforeEach } from 'vitest';
import { getRegistry } from '../../registry.js';
import type { HttpContext, BiocliResult } from '../../types.js';
import { ArgumentError, CliError, EmptyResultError, EXIT_CODES } from '../../errors.js';

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

import './files.js';

const HUB_PRIDE_RESPONSE = {
  datasetSummary: { hostingRepository: 'PRIDE' },
};

const HUB_IPROX_RESPONSE = {
  datasetSummary: { hostingRepository: 'iProX' },
};

const PRIDE_FILES_RESPONSE = [
  {
    accession: 'file1',
    fileName: 'sample.mzML',
    fileCategory: { name: 'Result file' },
    fileSizeBytes: 1024 * 1024 * 15, // 15 MB
    checksum: 'abc123',
    publicFileLocations: [
      { name: 'FTP Protocol', value: 'ftp://ftp.pride.ebi.ac.uk/pride/data/archive/2012/03/PXD000001/sample.mzML' },
      { name: 'Aspera Protocol', value: 'prd_ascp@fasp.ebi.ac.uk:pride/data/archive/2012/03/PXD000001/sample.mzML' },
    ],
    submissionDate: '2012-03-13',
  },
  {
    accession: 'file2',
    fileName: 'raw.raw',
    fileCategory: { name: 'Raw file' },
    fileSizeBytes: 1024 * 1024 * 1024 * 2, // 2 GB
    publicFileLocations: [
      { name: 'FTP Protocol', value: 'ftp://ftp.pride.ebi.ac.uk/pride/data/archive/2012/03/PXD000001/raw.raw' },
    ],
  },
];

function makePxCtx(hubResponse: unknown): HttpContext {
  return {
    databaseId: 'proteomexchange',
    fetch: async () => { throw new Error('unexpected'); },
    fetchXml: async () => { throw new Error('unexpected'); },
    fetchText: async () => { throw new Error('unexpected'); },
    fetchJson: async (url: string) => {
      if (url.includes('/datasets/')) return hubResponse;
      throw new Error(`Unexpected PX url: ${url}`);
    },
  };
}

function makePrideCtx(behavior: 'success' | 'empty' | 'unused'): HttpContext {
  return {
    databaseId: 'pride',
    fetch: async () => { throw new Error('unexpected'); },
    fetchXml: async () => { throw new Error('unexpected'); },
    fetchText: async () => { throw new Error('unexpected'); },
    fetchJson: async (url: string) => {
      if (behavior === 'unused') throw new Error('PRIDE should not be called');
      if (behavior === 'empty') return [];
      if (url.includes('/files')) return PRIDE_FILES_RESPONSE;
      throw new Error(`Unexpected PRIDE url: ${url}`);
    },
  };
}

describe('px/files adapter', () => {
  beforeEach(() => {
    createHttpContextForDatabaseMock.mockReset();
  });

  it('registers as px/files', () => {
    const cmd = getRegistry().get('px/files');
    expect(cmd).toBeDefined();
    expect(cmd?.database).toBe('aggregate');
  });

  it('PRIDE-hosted: returns flat rows with ftpUrl and size projection', async () => {
    createHttpContextForDatabaseMock.mockImplementation((id: string) => {
      if (id === 'proteomexchange') return makePxCtx(HUB_PRIDE_RESPONSE);
      if (id === 'pride') return makePrideCtx('success');
      throw new Error(`unexpected db: ${id}`);
    });

    const cmd = getRegistry().get('px/files');
    const result = await cmd!.func!({} as HttpContext, { accession: 'PXD000001' }) as BiocliResult<Record<string, unknown>[]>;

    expect(result.sources).toEqual(['PRIDE']);
    expect(result.data).toHaveLength(2);
    const first = (result.data as Record<string, unknown>[])[0];
    expect(first.fileName).toBe('sample.mzML');
    expect(first.category).toBe('Result file');
    expect(first.sizeHuman).toBe('15.0 MB');
    expect(first.ftpUrl).toContain('ftp://');
    expect(first.ftpUrl).toContain('sample.mzML');
    // 2 GB size formatted
    const second = (result.data as Record<string, unknown>[])[1];
    expect(second.sizeHuman).toMatch(/GB/);
  });

  it('iProX-hosted: throws NOT_SUPPORTED with SERVICE_UNAVAIL exit code', async () => {
    createHttpContextForDatabaseMock.mockImplementation((id: string) => {
      if (id === 'proteomexchange') return makePxCtx(HUB_IPROX_RESPONSE);
      if (id === 'pride') return makePrideCtx('unused');
      throw new Error(`unexpected db: ${id}`);
    });

    const cmd = getRegistry().get('px/files');
    try {
      await cmd!.func!({} as HttpContext, { accession: 'PXD076741' });
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(CliError);
      const cliErr = err as CliError;
      expect(cliErr.code).toBe('NOT_SUPPORTED');
      expect(cliErr.exitCode).toBe(EXIT_CODES.SERVICE_UNAVAIL);
      expect(cliErr.hint).toContain('iProX');
      expect(cliErr.hint).toContain('iprox.cn');
    }
  });

  it('invalid PXD format → ArgumentError', async () => {
    const cmd = getRegistry().get('px/files');
    await expect(
      cmd!.func!({} as HttpContext, { accession: 'MSV000079514' }),
    ).rejects.toBeInstanceOf(ArgumentError);
  });

  it('empty PRIDE file list → EmptyResultError', async () => {
    createHttpContextForDatabaseMock.mockImplementation((id: string) => {
      if (id === 'proteomexchange') return makePxCtx(HUB_PRIDE_RESPONSE);
      if (id === 'pride') return makePrideCtx('empty');
      throw new Error(`unexpected db: ${id}`);
    });
    const cmd = getRegistry().get('px/files');
    await expect(
      cmd!.func!({} as HttpContext, { accession: 'PXD000001' }),
    ).rejects.toBeInstanceOf(EmptyResultError);
  });

  it('empty hub response → EmptyResultError', async () => {
    createHttpContextForDatabaseMock.mockImplementation((id: string) => {
      if (id === 'proteomexchange') return makePxCtx({});
      if (id === 'pride') return makePrideCtx('unused');
      throw new Error(`unexpected db: ${id}`);
    });
    const cmd = getRegistry().get('px/files');
    await expect(
      cmd!.func!({} as HttpContext, { accession: 'PXD999999' }),
    ).rejects.toBeInstanceOf(EmptyResultError);
  });
});
