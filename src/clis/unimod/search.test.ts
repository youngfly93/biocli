import { describe, expect, it, vi, beforeEach } from 'vitest';
import { getRegistry } from '../../registry.js';
import type { HttpContext } from '../../types.js';
import type { UnimodIndex, UnimodMod } from '../../datasets/unimod.js';
import { hasResultMeta } from '../../types.js';

const { loadUnimodMock } = vi.hoisted(() => ({ loadUnimodMock: vi.fn() }));

vi.mock('../../datasets/unimod.js', async (importOriginal) => {
  const actual = await importOriginal() as Record<string, unknown>;
  return { ...actual, loadUnimod: loadUnimodMock };
});

import './search.js';

function makeCtx(): HttpContext {
  return {
    databaseId: 'unimod',
    fetch: async () => { throw new Error(); },
    fetchXml: async () => { throw new Error(); },
    fetchText: async () => { throw new Error(); },
    fetchJson: async () => { throw new Error(); },
  };
}

function mod(p: Pick<UnimodMod, 'recordId' | 'title' | 'fullName' | 'altNames'>): UnimodMod {
  return {
    accession: `UNIMOD:${p.recordId}`,
    recordId: p.recordId,
    title: p.title,
    fullName: p.fullName,
    altNames: p.altNames,
    approved: true,
    monoMass: 42.0,
    avgMass: 42.0,
    composition: '',
    specificities: [],
    xrefs: [],
  };
}

const mods: UnimodMod[] = [
  mod({ recordId: 21, title: 'Phospho', fullName: 'Phosphorylation', altNames: [] }),
  mod({ recordId: 43, title: 'HexNAc', fullName: 'N-Acetylhexosamine', altNames: [] }),
  mod({ recordId: 186, title: 'HPG', fullName: 'Hydroxyphenylglyoxal arginine', altNames: ['HPG arginine'] }),
  mod({ recordId: 188, title: 'Label:13C(6)', fullName: '13C(6) Silac label', altNames: ['SILAC heavy K+R', 'Heavy carbon label'] }),
  mod({ recordId: 737, title: 'TMT6plex', fullName: 'Sixplex Tandem Mass Tag', altNames: [] }),
];

const fakeIndex: UnimodIndex = {
  mods,
  byRecordId: new Map(mods.map(m => [m.recordId, m])),
  byTitleLower: new Map(mods.map(m => [m.title.toLowerCase(), m])),
  classifications: [],
  sites: [],
  parseMeta: { source: 'test', fetchedAt: '2026-04-01T00:00:00Z', modCount: mods.length, staleAfterDays: 90 },
};

function unwrap(result: unknown): Record<string, unknown>[] {
  if (hasResultMeta(result)) return result.rows as Record<string, unknown>[];
  throw new Error('expected ResultWithMeta');
}

describe('unimod/search adapter', () => {
  beforeEach(() => {
    loadUnimodMock.mockReset();
    loadUnimodMock.mockResolvedValue(fakeIndex);
  });

  it('finds matches in title (substring)', async () => {
    const cmd = getRegistry().get('unimod/search');
    const rows = unwrap(await cmd!.func!(makeCtx(), { query: 'phospho' }));
    expect(rows.map(r => r.title)).toEqual(['Phospho']);
  });

  it('finds matches in full name', async () => {
    const cmd = getRegistry().get('unimod/search');
    const rows = unwrap(await cmd!.func!(makeCtx(), { query: 'hexosamine' }));
    expect(rows.map(r => r.title)).toEqual(['HexNAc']);
  });

  it('finds matches in alt names', async () => {
    const cmd = getRegistry().get('unimod/search');
    const rows = unwrap(await cmd!.func!(makeCtx(), { query: 'silac' }));
    expect(rows.map(r => r.title)).toEqual(['Label:13C(6)']);
  });

  it('is case-insensitive', async () => {
    const cmd = getRegistry().get('unimod/search');
    const rows = unwrap(await cmd!.func!(makeCtx(), { query: 'TMT' }));
    expect(rows.map(r => r.title)).toEqual(['TMT6plex']);
  });

  it('exact mode rejects substrings', async () => {
    const cmd = getRegistry().get('unimod/search');
    const sub = unwrap(await cmd!.func!(makeCtx(), { query: 'phospho', exact: false }));
    const ex = unwrap(await cmd!.func!(makeCtx(), { query: 'phospho', exact: true }));
    // Substring matches Phospho via title; exact match only works on full lowercased title
    expect(sub.length).toBe(1);
    expect(ex.length).toBe(1); // title="Phospho".toLowerCase() === "phospho" ✓
    const exStrict = unwrap(await cmd!.func!(makeCtx(), { query: 'phos', exact: true }));
    expect(exStrict.length).toBe(0);
  });

  it('respects limit', async () => {
    const cmd = getRegistry().get('unimod/search');
    const rows = unwrap(await cmd!.func!(makeCtx(), { query: 'a', limit: 2 }));
    expect(rows.length).toBeLessThanOrEqual(2);
  });

  it('returns withMeta with totalCount + query', async () => {
    const cmd = getRegistry().get('unimod/search');
    const result = await cmd!.func!(makeCtx(), { query: 'phospho' });
    if (!hasResultMeta(result)) throw new Error('expected ResultWithMeta');
    expect(result.meta.query).toBe('phospho');
    expect(result.meta.totalCount).toBe(1);
  });

  it('handles empty query gracefully', async () => {
    const cmd = getRegistry().get('unimod/search');
    const rows = unwrap(await cmd!.func!(makeCtx(), { query: '' }));
    expect(rows).toEqual([]);
  });
});
