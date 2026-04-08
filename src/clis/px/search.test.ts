import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getRegistry } from '../../registry.js';
import { hasResultMeta } from '../../types.js';
import type { HttpContext } from '../../types.js';
import './search.js';

const FIXTURE_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '_shared',
  '__fixtures__',
);
const PROXI_SEARCH = JSON.parse(
  readFileSync(join(FIXTURE_DIR, 'proxi-search-tp53.json'), 'utf-8'),
);

function makeCtx(handler: (url: string) => unknown): HttpContext {
  return {
    databaseId: 'proteomexchange',
    fetch: async () => { throw new Error('unexpected'); },
    fetchXml: async () => { throw new Error('unexpected'); },
    fetchText: async () => { throw new Error('unexpected'); },
    fetchJson: async (url: string) => handler(url),
  };
}

function unwrap(result: unknown): Record<string, unknown>[] {
  if (hasResultMeta(result)) return result.rows as Record<string, unknown>[];
  throw new Error('expected ResultWithMeta');
}

describe('px/search adapter', () => {
  it('registers under px/search with the proteomexchange database', () => {
    const cmd = getRegistry().get('px/search');
    expect(cmd).toBeDefined();
    expect(cmd?.database).toBe('proteomexchange');
  });

  it('zips the compact PROXI rows with column headers into flat objects', async () => {
    const cmd = getRegistry().get('px/search');
    const rows = unwrap(
      await cmd!.func!(
        makeCtx((url) => {
          expect(url).toContain('/datasets');
          expect(url).toContain('search=TP53');
          return PROXI_SEARCH;
        }),
        { query: 'TP53', limit: 20, page: 1 },
      ),
    );
    expect(rows.length).toBe(3);
    const first = rows[0];
    expect(first.accession).toBe('PXD061458');
    expect(first.repository).toBe('MassIVE');
    expect(first.title).toMatch(/CRL3-GMCL1/);
    expect(first.species).toMatch(/Homo sapiens/);
    expect('sdrf' in first).toBe(true);
  });

  it('propagates totalCount from result_set.n_available_rows', async () => {
    const cmd = getRegistry().get('px/search');
    const result = await cmd!.func!(
      makeCtx(() => PROXI_SEARCH),
      { query: 'TP53' },
    );
    if (!hasResultMeta(result)) throw new Error('expected ResultWithMeta');
    expect(result.meta.totalCount).toBe(PROXI_SEARCH.result_set.n_available_rows);
    expect(result.meta.query).toBe('TP53');
  });

  it('passes through pagination + typed filters as PROXI params', async () => {
    const cmd = getRegistry().get('px/search');
    let capturedUrl = '';
    await cmd!.func!(
      makeCtx((url) => {
        capturedUrl = url;
        return PROXI_SEARCH;
      }),
      {
        query: 'phospho',
        modification: 'Phospho',
        repository: 'PRIDE',
        limit: 5,
        page: 2,
      },
    );
    expect(capturedUrl).toContain('search=phospho');
    expect(capturedUrl).toContain('modification=Phospho');
    expect(capturedUrl).toContain('repository=PRIDE');
    expect(capturedUrl).toContain('pageSize=5');
    expect(capturedUrl).toContain('pageNumber=2');
  });

  it('handles empty query (unfiltered browse)', async () => {
    const cmd = getRegistry().get('px/search');
    let capturedUrl = '';
    await cmd!.func!(
      makeCtx((url) => {
        capturedUrl = url;
        return PROXI_SEARCH;
      }),
      { query: '', limit: 10, page: 1 },
    );
    expect(capturedUrl).not.toContain('search=');
  });

  it('throws PARSE_ERROR when result_set.datasets_title_list is missing', async () => {
    const cmd = getRegistry().get('px/search');
    await expect(
      cmd!.func!(
        makeCtx(() => ({ datasets: [], result_set: {} })),
        { query: 'anything' },
      ),
    ).rejects.toThrow();
  });

  it('clamps limit to the [1, 500] range', async () => {
    const cmd = getRegistry().get('px/search');
    let capturedUrl = '';
    await cmd!.func!(
      makeCtx((url) => {
        capturedUrl = url;
        return PROXI_SEARCH;
      }),
      { query: 'x', limit: 9999, page: 1 },
    );
    expect(capturedUrl).toContain('pageSize=500');
  });
});
