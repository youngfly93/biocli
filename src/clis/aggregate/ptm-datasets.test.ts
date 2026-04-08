import { describe, expect, it, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getRegistry } from '../../registry.js';
import type { HttpContext, BiocliResult } from '../../types.js';
import { ArgumentError, EmptyResultError } from '../../errors.js';

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

import './ptm-datasets.js';

const FIXTURE_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '_shared',
  '__fixtures__',
);
const SEARCH_FIXTURE = JSON.parse(
  readFileSync(join(FIXTURE_DIR, 'proxi-search-tp53.json'), 'utf-8'),
);

function makePxCtx(handler: (url: string) => unknown): HttpContext {
  return {
    databaseId: 'proteomexchange',
    fetch: async () => { throw new Error('unexpected'); },
    fetchXml: async () => { throw new Error('unexpected'); },
    fetchText: async () => { throw new Error('unexpected'); },
    fetchJson: async (url: string) => handler(url),
  };
}

describe('aggregate/ptm-datasets', () => {
  beforeEach(() => {
    createHttpContextForDatabaseMock.mockReset();
  });

  it('registers as aggregate/ptm-datasets with database=aggregate', () => {
    const cmd = getRegistry().get('aggregate/ptm-datasets');
    expect(cmd).toBeDefined();
    expect(cmd?.database).toBe('aggregate');
  });

  it('TP53 + phospho maps to Phospho modification filter and returns ranked list', async () => {
    let capturedUrl = '';
    createHttpContextForDatabaseMock.mockImplementation((id: string) => {
      if (id === 'proteomexchange') {
        return makePxCtx((url) => { capturedUrl = url; return SEARCH_FIXTURE; });
      }
      throw new Error(`unexpected db: ${id}`);
    });

    const cmd = getRegistry().get('aggregate/ptm-datasets');
    const result = await cmd!.func!(
      {} as HttpContext,
      { gene: 'TP53', modification: 'phospho', limit: 20 },
    ) as BiocliResult<{ datasets: Record<string, unknown>[]; gene: string; modification: string }>;

    // URL correctness: gene goes through keywords= (NOT search=), because
    // PROXI drops modification= when search= is present.
    expect(capturedUrl).toContain('keywords=TP53');
    expect(capturedUrl).toContain('modification=Phospho');
    expect(capturedUrl).not.toContain('search=TP53');

    // Envelope
    expect(result.sources).toEqual(['ProteomeXchange']);
    expect(result.warnings.length).toBe(1);
    expect(result.warnings[0]).toMatch(/declared keywords/);
    expect(result.query).toBe('TP53');
    expect(result.ids.gene).toBe('TP53');
    expect(result.ids.modification).toBe('Phospho');

    // Data payload
    const data = result.data;
    expect(data.datasets.length).toBeGreaterThan(0);
    expect(data.gene).toBe('TP53');
    expect(data.modification).toBe('Phospho');
    // Rows have expected fields via the compact-format zipping
    expect(data.datasets[0]).toHaveProperty('accession');
    expect(data.datasets[0]).toHaveProperty('repository');
    expect(data.datasets[0]).toHaveProperty('announceDate');
  });

  it('normalizes modification aliases (phosphorylation → Phospho)', async () => {
    let capturedUrl = '';
    createHttpContextForDatabaseMock.mockImplementation(() => makePxCtx((url) => {
      capturedUrl = url;
      return SEARCH_FIXTURE;
    }));
    const cmd = getRegistry().get('aggregate/ptm-datasets');
    await cmd!.func!(
      {} as HttpContext,
      { gene: 'TP53', modification: 'phosphorylation' },
    );
    expect(capturedUrl).toContain('modification=Phospho');
  });

  it('ubiq / ubiquitination → GlyGly (the di-glycine remnant)', async () => {
    let capturedUrl = '';
    createHttpContextForDatabaseMock.mockImplementation(() => makePxCtx((url) => {
      capturedUrl = url;
      return SEARCH_FIXTURE;
    }));
    const cmd = getRegistry().get('aggregate/ptm-datasets');
    await cmd!.func!({} as HttpContext, { gene: 'TP53', modification: 'ubiq' });
    expect(capturedUrl).toContain('modification=GlyGly');
  });

  it('unsupported modification → ArgumentError with supported list in hint', async () => {
    createHttpContextForDatabaseMock.mockImplementation(() => {
      throw new Error('should not be called');
    });
    const cmd = getRegistry().get('aggregate/ptm-datasets');
    await expect(
      cmd!.func!({} as HttpContext, { gene: 'TP53', modification: 'nonsense' }),
    ).rejects.toBeInstanceOf(ArgumentError);
  });

  it('empty gene → ArgumentError', async () => {
    const cmd = getRegistry().get('aggregate/ptm-datasets');
    await expect(
      cmd!.func!({} as HttpContext, { gene: '', modification: 'phospho' }),
    ).rejects.toBeInstanceOf(ArgumentError);
  });

  it('empty PROXI result → EmptyResultError', async () => {
    createHttpContextForDatabaseMock.mockImplementation(() => makePxCtx(() => ({
      datasets: [],
      result_set: { datasets_title_list: [], n_available_rows: 0, n_rows_returned: 0 },
    })));
    const cmd = getRegistry().get('aggregate/ptm-datasets');
    await expect(
      cmd!.func!({} as HttpContext, { gene: 'UNKNOWN_GENE_XYZ', modification: 'phospho' }),
    ).rejects.toBeInstanceOf(EmptyResultError);
  });

  it('repository filter propagates to PROXI', async () => {
    let capturedUrl = '';
    createHttpContextForDatabaseMock.mockImplementation(() => makePxCtx((url) => {
      capturedUrl = url;
      return SEARCH_FIXTURE;
    }));
    const cmd = getRegistry().get('aggregate/ptm-datasets');
    await cmd!.func!(
      {} as HttpContext,
      { gene: 'TP53', modification: 'phospho', repository: 'PRIDE' },
    );
    expect(capturedUrl).toContain('repository=PRIDE');
  });

  it('clamps limit to [1, 500]', async () => {
    let capturedUrl = '';
    createHttpContextForDatabaseMock.mockImplementation(() => makePxCtx((url) => {
      capturedUrl = url;
      return SEARCH_FIXTURE;
    }));
    const cmd = getRegistry().get('aggregate/ptm-datasets');
    await cmd!.func!(
      {} as HttpContext,
      { gene: 'TP53', modification: 'phospho', limit: 9999 },
    );
    expect(capturedUrl).toContain('pageSize=500');
  });
});
