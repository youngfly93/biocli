import { describe, expect, it, vi, beforeEach } from 'vitest';
import { getRegistry } from '../../registry.js';
import type { HttpContext } from '../../types.js';
import { hasResultMeta } from '../../types.js';
import type { UnimodIndex, UnimodMod, UnimodSpecificity } from '../../datasets/unimod.js';
import { EmptyResultError } from '../../errors.js';

const { loadUnimodMock } = vi.hoisted(() => ({ loadUnimodMock: vi.fn() }));

vi.mock('../../datasets/unimod.js', async (importOriginal) => {
  const actual = await importOriginal() as Record<string, unknown>;
  return { ...actual, loadUnimod: loadUnimodMock };
});

import './fetch.js';

function makeCtx(): HttpContext {
  return {
    databaseId: 'unimod',
    fetch: async () => { throw new Error(); },
    fetchXml: async () => { throw new Error(); },
    fetchText: async () => { throw new Error(); },
    fetchJson: async () => { throw new Error(); },
  };
}

function spec(site: string, opts: Partial<UnimodSpecificity> = {}): UnimodSpecificity {
  return { site, position: 'Anywhere', classification: 'Post-translational', hidden: false, ...opts };
}

const phospho: UnimodMod = {
  recordId: 21,
  accession: 'UNIMOD:21',
  title: 'Phospho',
  fullName: 'Phosphorylation',
  approved: true,
  monoMass: 79.966331,
  avgMass: 79.9799,
  composition: 'H O(3) P',
  specificities: [
    spec('S', { neutralLossMono: 97.976896, neutralLossComposition: 'H(3) O(4) P' }),
    spec('T', { neutralLossMono: 97.976896, neutralLossComposition: 'H(3) O(4) P' }),
    spec('Y'),
  ],
  altNames: ['Phosphoryl'],
  xrefs: [{ source: 'RESID', text: 'AA0037' }, { source: 'PubMed PMID', text: '12345' }],
};

const fakeIndex: UnimodIndex = {
  mods: [phospho],
  byRecordId: new Map([[21, phospho]]),
  byTitleLower: new Map([['phospho', phospho]]),
  classifications: ['Post-translational'],
  sites: ['S', 'T', 'Y'],
  parseMeta: { source: 'test', fetchedAt: '2026-04-01T00:00:00Z', modCount: 1, staleAfterDays: 90 },
};

function unwrap(result: unknown): Record<string, unknown>[] {
  if (hasResultMeta(result)) return result.rows as Record<string, unknown>[];
  throw new Error('expected ResultWithMeta');
}

describe('unimod/fetch adapter (lookup by accession or name)', () => {
  beforeEach(() => {
    loadUnimodMock.mockReset();
    loadUnimodMock.mockResolvedValue(fakeIndex);
  });

  it('registers as unimod/fetch (NOT install)', () => {
    const cmd = getRegistry().get('unimod/fetch');
    expect(cmd).toBeDefined();
    expect(cmd?.database).toBe('unimod');
  });

  it('looks up by plain integer record_id', async () => {
    const cmd = getRegistry().get('unimod/fetch');
    const rows = unwrap(await cmd!.func!(makeCtx(), { accession: '21' }));
    expect(rows.length).toBe(3); // one row per specificity
    expect(rows[0].title).toBe('Phospho');
    expect(rows[0].accession).toBe('UNIMOD:21');
  });

  it('looks up by UNIMOD: prefixed accession', async () => {
    const cmd = getRegistry().get('unimod/fetch');
    const rows = unwrap(await cmd!.func!(makeCtx(), { accession: 'UNIMOD:21' }));
    expect(rows[0].title).toBe('Phospho');
  });

  it('UNIMOD: prefix is case-insensitive', async () => {
    const cmd = getRegistry().get('unimod/fetch');
    const rows = unwrap(await cmd!.func!(makeCtx(), { accession: 'unimod:21' }));
    expect(rows[0].title).toBe('Phospho');
  });

  it('looks up by exact title (case-insensitive)', async () => {
    const cmd = getRegistry().get('unimod/fetch');
    const rowsLower = unwrap(await cmd!.func!(makeCtx(), { accession: 'phospho' }));
    const rowsExact = unwrap(await cmd!.func!(makeCtx(), { accession: 'Phospho' }));
    expect(rowsLower).toEqual(rowsExact);
    expect(rowsLower[0].title).toBe('Phospho');
  });

  it('returns one row per specificity with shared mod metadata', async () => {
    const cmd = getRegistry().get('unimod/fetch');
    const rows = unwrap(await cmd!.func!(makeCtx(), { accession: '21' }));
    expect(rows.length).toBe(3);
    const sites = rows.map(r => r.site).sort();
    expect(sites).toEqual(['S', 'T', 'Y']);
    for (const r of rows) {
      expect(r.recordId).toBe(21);
      expect(r.monoMass).toBe(79.966331);
      expect(r.composition).toBe('H O(3) P');
    }
    const sRow = rows.find(r => r.site === 'S')!;
    expect(sRow.neutralLossMono).toBeCloseTo(97.976896, 6);
    const yRow = rows.find(r => r.site === 'Y')!;
    expect(yRow.neutralLossMono).toBeNull();
  });

  it('flattens altNames + xrefs to single strings on each row', async () => {
    const cmd = getRegistry().get('unimod/fetch');
    const rows = unwrap(await cmd!.func!(makeCtx(), { accession: '21' }));
    expect(rows[0].altNames).toBe('Phosphoryl');
    expect(rows[0].xrefs).toContain('RESID:AA0037');
    expect(rows[0].xrefs).toContain('PubMed PMID:12345');
  });

  it('throws EmptyResultError on unknown accession', async () => {
    const cmd = getRegistry().get('unimod/fetch');
    await expect(cmd!.func!(makeCtx(), { accession: '99999' })).rejects.toBeInstanceOf(EmptyResultError);
    await expect(cmd!.func!(makeCtx(), { accession: 'NotARealMod' })).rejects.toBeInstanceOf(EmptyResultError);
  });

  it('throws ArgumentError on empty accession', async () => {
    const cmd = getRegistry().get('unimod/fetch');
    await expect(cmd!.func!(makeCtx(), { accession: '' })).rejects.toThrow();
  });
});
