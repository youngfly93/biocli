import { describe, expect, it, vi, beforeEach } from 'vitest';
import { getRegistry } from '../../registry.js';
import type { HttpContext, BiocliResult } from '../../types.js';
import { ArgumentError, EmptyResultError } from '../../errors.js';

// Mock the backend factory so dataset.ts gets our injected contexts.
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

import './dataset.js';

const HUB_PRIDE_RESPONSE = {
  identifiers: [{ id: 'PXD000001' }],
  title: 'TMT spikes',
  description: 'hub description',
  datasetSummary: {
    announceDate: '2012-03-07',
    hostingRepository: 'PRIDE',
  },
  species: [{ name: 'Erwinia carotovora' }],
  instruments: [{ name: 'LTQ Orbitrap Velos' }],
};

const HUB_IPROX_RESPONSE = {
  identifiers: [{ id: 'PXD076741' }],
  title: 'iProX dataset title',
  datasetSummary: { hostingRepository: 'iProX' },
};

const PRIDE_DETAIL_RESPONSE = {
  accession: 'PXD000001',
  title: 'Full PRIDE title',
  projectDescription: 'Long rich description from PRIDE (272 chars)',
  identifiedPTMStrings: [{ '@type': 'CvParam', name: 'monohydroxylated residue' }],
  submitters: [{ firstName: 'Laurent', lastName: 'Gatto' }],
};

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

function makePrideCtx(behavior: 'success' | 'fail' | 'unused'): HttpContext {
  return {
    databaseId: 'pride',
    fetch: async () => { throw new Error('unexpected'); },
    fetchXml: async () => { throw new Error('unexpected'); },
    fetchText: async () => { throw new Error('unexpected'); },
    fetchJson: async (url: string) => {
      if (behavior === 'unused') throw new Error('PRIDE should not be called');
      if (behavior === 'fail') throw new Error('PRIDE returned HTTP 503 after 3 attempts');
      if (url.includes('/projects/PXD000001')) return PRIDE_DETAIL_RESPONSE;
      throw new Error(`Unexpected PRIDE url: ${url}`);
    },
  };
}

describe('px/dataset adapter', () => {
  beforeEach(() => {
    createHttpContextForDatabaseMock.mockReset();
  });

  it('registers as px/dataset with database=aggregate', () => {
    const cmd = getRegistry().get('px/dataset');
    expect(cmd).toBeDefined();
    expect(cmd?.database).toBe('aggregate');
  });

  it('PRIDE-hosted: hub + PRIDE upgrade both succeed → native status', async () => {
    createHttpContextForDatabaseMock.mockImplementation((id: string) => {
      if (id === 'proteomexchange') return makePxCtx(HUB_PRIDE_RESPONSE);
      if (id === 'pride') return makePrideCtx('success');
      throw new Error(`unexpected db: ${id}`);
    });
    const cmd = getRegistry().get('px/dataset');
    const result = await cmd!.func!({} as HttpContext, { accession: 'PXD000001', detailed: true }) as BiocliResult<Record<string, unknown>>;

    expect(result.sources).toContain('ProteomeXchange');
    expect(result.sources).toContain('PRIDE');
    expect(result.warnings).toEqual([]);
    expect((result.data as Record<string, unknown>).repositoryStatus).toBe('native');
    // PRIDE detail merged over hub
    expect((result.data as Record<string, unknown>).title).toBe('Full PRIDE title');
    expect((result.data as Record<string, unknown>).projectDescription).toContain('272 chars');
    expect((result.data as Record<string, unknown>).identifiedPTMStrings).toBeDefined();
  });

  it('PRIDE-hosted but PRIDE 503 → degraded status with warning', async () => {
    createHttpContextForDatabaseMock.mockImplementation((id: string) => {
      if (id === 'proteomexchange') return makePxCtx(HUB_PRIDE_RESPONSE);
      if (id === 'pride') return makePrideCtx('fail');
      throw new Error(`unexpected db: ${id}`);
    });
    const cmd = getRegistry().get('px/dataset');
    const result = await cmd!.func!({} as HttpContext, { accession: 'PXD000001', detailed: true }) as BiocliResult<Record<string, unknown>>;

    expect((result.data as Record<string, unknown>).repositoryStatus).toBe('degraded');
    expect(result.sources).toContain('ProteomeXchange');
    expect(result.sources).not.toContain('PRIDE');
    expect(result.warnings.length).toBe(1);
    expect(result.warnings[0]).toContain('503');
    expect(result.warnings[0]).toContain('PXD000001');
    // Hub data still present
    expect((result.data as Record<string, unknown>).title).toBe('TMT spikes');
  });

  it('iProX-hosted: upgrade skipped → hub-only status, no PRIDE call', async () => {
    createHttpContextForDatabaseMock.mockImplementation((id: string) => {
      if (id === 'proteomexchange') return makePxCtx(HUB_IPROX_RESPONSE);
      if (id === 'pride') return makePrideCtx('unused');
      throw new Error(`unexpected db: ${id}`);
    });
    const cmd = getRegistry().get('px/dataset');
    const result = await cmd!.func!({} as HttpContext, { accession: 'PXD076741', detailed: true }) as BiocliResult<Record<string, unknown>>;

    expect((result.data as Record<string, unknown>).repositoryStatus).toBe('hub-only');
    expect(result.sources).toEqual(['ProteomeXchange']);
    expect(result.warnings).toEqual([]);
    expect((result.data as Record<string, unknown>).title).toBe('iProX dataset title');
  });

  it('--detailed false skips PRIDE upgrade even for PRIDE accessions', async () => {
    createHttpContextForDatabaseMock.mockImplementation((id: string) => {
      if (id === 'proteomexchange') return makePxCtx(HUB_PRIDE_RESPONSE);
      if (id === 'pride') return makePrideCtx('unused');
      throw new Error(`unexpected db: ${id}`);
    });
    const cmd = getRegistry().get('px/dataset');
    const result = await cmd!.func!({} as HttpContext, { accession: 'PXD000001', detailed: false }) as BiocliResult<Record<string, unknown>>;

    expect((result.data as Record<string, unknown>).repositoryStatus).toBe('hub-only');
    expect(result.sources).toEqual(['ProteomeXchange']);
  });

  it('rejects invalid PXD format (MassIVE id) with ArgumentError and helpful hint', async () => {
    createHttpContextForDatabaseMock.mockImplementation(() => {
      throw new Error('should not be called');
    });
    const cmd = getRegistry().get('px/dataset');
    await expect(
      cmd!.func!({} as HttpContext, { accession: 'MSV000079514', detailed: true }),
    ).rejects.toBeInstanceOf(ArgumentError);
  });

  it('throws EmptyResultError when hub returns an empty object', async () => {
    createHttpContextForDatabaseMock.mockImplementation((id: string) => {
      if (id === 'proteomexchange') return makePxCtx({});
      if (id === 'pride') return makePrideCtx('unused');
      throw new Error(`unexpected db: ${id}`);
    });
    const cmd = getRegistry().get('px/dataset');
    await expect(
      cmd!.func!({} as HttpContext, { accession: 'PXD999999', detailed: true }),
    ).rejects.toBeInstanceOf(EmptyResultError);
  });

  it('includes the PXD and hostingRepository in the result.ids envelope', async () => {
    createHttpContextForDatabaseMock.mockImplementation((id: string) => {
      if (id === 'proteomexchange') return makePxCtx(HUB_PRIDE_RESPONSE);
      if (id === 'pride') return makePrideCtx('success');
      throw new Error(`unexpected db: ${id}`);
    });
    const cmd = getRegistry().get('px/dataset');
    const result = await cmd!.func!({} as HttpContext, { accession: 'PXD000001', detailed: true }) as BiocliResult<Record<string, unknown>>;

    expect(result.ids.pxd).toBe('PXD000001');
    expect(result.ids.hostingRepository).toBe('PRIDE');
  });
});
