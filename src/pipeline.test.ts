import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { executePipeline } from './pipeline/executor.js';
import { getKnownStepNames, getStepHandler } from './pipeline/registry.js';
import { evalExpr, renderTemplate, renderValue, resolvePath } from './pipeline/template.js';
import { handleFetch } from './pipeline/steps/fetch.js';
import {
  handleFilter,
  handleLimit,
  handleMap,
  handleSelect,
  handleSort,
} from './pipeline/steps/transform.js';
import { handleXmlParse } from './pipeline/steps/xml-parse.js';

describe('pipeline registry and executor', () => {
  it('exposes the built-in pipeline step handlers', () => {
    expect(getKnownStepNames()).toEqual(
      expect.arrayContaining(['fetch', 'select', 'map', 'filter', 'sort', 'limit', 'xml-parse']),
    );
    expect(typeof getStepHandler('fetch')).toBe('function');
    expect(getStepHandler('missing-step')).toBeUndefined();
  });

  it('executes sequential pipeline steps across fetch/select/map/filter/sort/limit', async () => {
    const ctx = {
      fetch: vi.fn().mockResolvedValue(new Response(JSON.stringify({
        rows: [
          { symbol: 'BRCA1', score: 2 },
          { symbol: 'TP53', score: 9 },
          { symbol: 'EGFR', score: 5 },
        ],
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })),
      apiKey: 'abc123',
      email: 'me@example.com',
    };

    const result = await executePipeline([
      { fetch: { url: 'https://example.test/genes', params: { q: '${{ args.query }}' } } },
      { select: 'rows' },
      { map: { symbol: '${{ item.symbol }}', score: '${{ item.score }}' } },
      { filter: 'Number(item.score) >= Number(args.minScore)' },
      { sort: { by: 'score', order: 'desc' } },
      { limit: '${{ args.limit }}' },
    ], ctx as never, { query: 'tumor suppressor', minScore: 5, limit: 2 });

    expect(ctx.fetch).toHaveBeenCalledWith(
      'https://example.test/genes?q=tumor+suppressor&api_key=abc123&email=me%40example.com',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(result).toEqual([
      { symbol: 'TP53', score: 9 },
      { symbol: 'EGFR', score: 5 },
    ]);
  });

  it('fails on unknown pipeline steps with a useful message', async () => {
    await expect(
      executePipeline([{ nope: {} }], null, {}),
    ).rejects.toThrow(/Unknown pipeline step "nope"/);
  });
});

describe('pipeline template engine', () => {
  it('renders full expressions as raw typed values and supports recursive renderValue', () => {
    expect(renderTemplate('${{ args.limit }}', { args: { limit: 7 } })).toBe(7);
    expect(renderValue({
      gene: '${{ item.symbol | upper }}',
      nested: ['${{ args.kind }}', { index: '${{ index }}' }],
    }, {
      args: { kind: 'oncogene' },
      item: { symbol: 'egfr' },
      index: 2,
    })).toEqual({
      gene: 'EGFR',
      nested: ['oncogene', { index: 2 }],
    });
  });

  it('supports interpolation, filters, path lookup, and JS fallback expressions', () => {
    expect(renderTemplate('Gene ${{ item.symbol | upper }}', { item: { symbol: 'tp53' } })).toBe('Gene TP53');
    expect(renderTemplate('${{ item.tags | join(", ") }}', { item: { tags: ['DNA', 'repair'] } })).toBe('DNA, repair');
    expect(renderTemplate('${{ item.missing | default("fallback") }}', { item: {} })).toBe('fallback');
    expect(renderTemplate('${{ item.url | basename }}', { item: { url: 'https://x.test/files/report.tsv' } })).toBe('report.tsv');
    expect(renderTemplate('${{ "lung adenocarcinoma" | slugify }}', {})).toBe('lung-adenocarcinoma');
    expect(evalExpr('item.score > 5 ? item.label : args.alt', {
      args: { alt: 'low' },
      item: { score: 9, label: 'high' },
    })).toBe('high');
    expect(resolvePath('data.rows.1.symbol', {
      data: { rows: [{ symbol: 'TP53' }, { symbol: 'EGFR' }] },
    })).toBe('EGFR');
  });

  it('blocks dangerous fallback expressions', () => {
    expect(evalExpr('globalThis.process.exit()', {})).toBeUndefined();
    expect(evalExpr('args.constructor.constructor("return process")()', {
      args: { safe: true },
    })).toBeUndefined();
  });
});

describe('pipeline step handlers', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn> | undefined;

  beforeEach(() => {
    fetchSpy = undefined;
  });

  afterEach(() => {
    fetchSpy?.mockRestore();
  });

  it('fetches directly without a context and auto-parses XML', async () => {
    fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('<root><value>42</value></root>', {
        status: 200,
        headers: { 'content-type': 'application/xml' },
      }),
    );

    const result = await handleFetch(null, 'https://example.test/xml', null, {});
    expect(result).toEqual({ root: { value: 42 } });
  });

  it('supports per-item fetch fan-out and captures item-level failures', async () => {
    const ctx = {
      fetch: vi.fn(async (url: string) => {
        if (url.includes('/bad')) {
          return new Response('boom', { status: 500, statusText: 'Broken' });
        }
        return new Response(JSON.stringify({ url }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }),
    };

    const result = await handleFetch(
      ctx as never,
      { url: 'https://example.test/${{ item.id }}', concurrency: 2 },
      [{ id: 'ok' }, { id: 'bad' }],
      {},
    );

    expect(result).toEqual([
      { url: 'https://example.test/ok' },
      expect.objectContaining({ error: expect.stringContaining('HTTP 500 Broken') }),
    ]);
  });

  it('selects, maps, filters, sorts, and limits data as expected', async () => {
    const source = {
      rows: [
        { symbol: 'TP53', score: 9 },
        { symbol: 'BRCA1', score: 2 },
        { symbol: 'EGFR', score: 5 },
      ],
    };

    const selected = await handleSelect(null, 'rows.2.symbol', source, {});
    expect(selected).toBe('EGFR');

    const mapped = await handleMap(null, {
      select: 'rows',
      gene: '${{ item.symbol }}',
      score: '${{ item.score }}',
    }, source, {});
    expect(mapped).toEqual([
      { gene: 'TP53', score: 9 },
      { gene: 'BRCA1', score: 2 },
      { gene: 'EGFR', score: 5 },
    ]);

    const filtered = await handleFilter(null, 'Number(item.score) >= Number(args.min)', mapped, { min: 5 });
    expect(filtered).toEqual([
      { gene: 'TP53', score: 9 },
      { gene: 'EGFR', score: 5 },
    ]);

    const sorted = await handleSort(null, { by: 'gene', order: 'desc' }, filtered, {});
    expect(sorted).toEqual([
      { gene: 'TP53', score: 9 },
      { gene: 'EGFR', score: 5 },
    ]);

    const limited = await handleLimit(null, '${{ args.limit }}', sorted, { limit: 1 });
    expect(limited).toEqual([{ gene: 'TP53', score: 9 }]);
  });

  it('parses XML strings explicitly and passes through already-parsed data', async () => {
    await expect(handleXmlParse(null, null, '<root><gene>TP53</gene></root>', {})).resolves.toEqual({
      root: { gene: 'TP53' },
    });
    await expect(handleXmlParse(null, null, { already: 'parsed' }, {})).resolves.toEqual({
      already: 'parsed',
    });
  });
});
