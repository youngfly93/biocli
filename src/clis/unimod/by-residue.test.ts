import { describe, expect, it, vi, beforeEach } from 'vitest';
import { getRegistry } from '../../registry.js';
import type { HttpContext } from '../../types.js';
import { hasResultMeta } from '../../types.js';
import type { UnimodIndex, UnimodMod, UnimodSpecificity } from '../../datasets/unimod.js';

const { loadUnimodMock } = vi.hoisted(() => ({ loadUnimodMock: vi.fn() }));

vi.mock('../../datasets/unimod.js', async (importOriginal) => {
  const actual = await importOriginal() as Record<string, unknown>;
  return { ...actual, loadUnimod: loadUnimodMock };
});

import './by-residue.js';

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
function mod(recordId: number, title: string, monoMass: number, specificities: UnimodSpecificity[]): UnimodMod {
  return {
    recordId,
    accession: `UNIMOD:${recordId}`,
    title,
    fullName: title,
    approved: true,
    monoMass,
    avgMass: monoMass,
    composition: '',
    specificities,
    altNames: [],
    xrefs: [],
  };
}

const phospho = mod(21, 'Phospho', 79.966331, [spec('S'), spec('T'), spec('Y'), spec('K', { hidden: true })]);
const acetyl = mod(1, 'Acetyl', 42.010565, [
  spec('K', { classification: 'Multiple' }),
  spec('N-term', { position: 'Protein N-term' }),
]);
const ubiq = mod(121, 'GG', 114.0429, [spec('K', { classification: 'Post-translational' })]);
const glycan = mod(43, 'HexNAc', 203.0794, [spec('S', { classification: 'O-linked glycosylation', hidden: true })]);

const fakeIndex: UnimodIndex = {
  mods: [acetyl, phospho, ubiq, glycan],
  byRecordId: new Map(),
  byTitleLower: new Map(),
  classifications: [],
  sites: [],
  parseMeta: { source: 'test', fetchedAt: '2026-04-01T00:00:00Z', modCount: 4, staleAfterDays: 90 },
};

function unwrap(result: unknown): Record<string, unknown>[] {
  if (hasResultMeta(result)) return result.rows as Record<string, unknown>[];
  throw new Error('expected ResultWithMeta');
}

describe('unimod/by-residue adapter', () => {
  beforeEach(() => {
    loadUnimodMock.mockReset();
    loadUnimodMock.mockResolvedValue(fakeIndex);
  });

  it('registers as unimod/by-residue', () => {
    expect(getRegistry().get('unimod/by-residue')).toBeDefined();
  });

  it('finds all visible modifications on K', async () => {
    const cmd = getRegistry().get('unimod/by-residue');
    const rows = unwrap(await cmd!.func!(makeCtx(), { residue: 'K' }));
    // Acetyl (K, Multiple) + GG (K, Post-translational). Phospho K is hidden.
    expect(rows.map(r => r.title).sort()).toEqual(['Acetyl', 'GG']);
  });

  it('normalizes single-letter residue to uppercase', async () => {
    const cmd = getRegistry().get('unimod/by-residue');
    const rows = unwrap(await cmd!.func!(makeCtx(), { residue: 's' }));
    expect(rows.map(r => r.title)).toContain('Phospho');
  });

  it('classification filter narrows the result', async () => {
    const cmd = getRegistry().get('unimod/by-residue');
    const rows = unwrap(await cmd!.func!(makeCtx(), { residue: 'K', classification: 'Post-translational' }));
    expect(rows.map(r => r.title)).toEqual(['GG']);
  });

  it('position filter handles Protein N-term', async () => {
    const cmd = getRegistry().get('unimod/by-residue');
    const rows = unwrap(await cmd!.func!(makeCtx(), { residue: 'N-term', position: 'Protein N-term' }));
    expect(rows.map(r => r.title)).toEqual(['Acetyl']);
    expect(rows[0].site).toBe('N-term');
  });

  it('include-hidden surfaces hidden specificities', async () => {
    const cmd = getRegistry().get('unimod/by-residue');
    const rows = unwrap(await cmd!.func!(makeCtx(), { residue: 'S', 'include-hidden': true }));
    // Phospho/S (visible) + HexNAc/S (hidden)
    const titles = rows.map(r => r.title).sort();
    expect(titles).toContain('Phospho');
    expect(titles).toContain('HexNAc');
  });

  it('carries queryResidue on every row', async () => {
    const cmd = getRegistry().get('unimod/by-residue');
    const rows = unwrap(await cmd!.func!(makeCtx(), { residue: 'K' }));
    expect(rows.every(r => r.queryResidue === 'K')).toBe(true);
  });

  it('rejects empty residue', async () => {
    const cmd = getRegistry().get('unimod/by-residue');
    await expect(cmd!.func!(makeCtx(), { residue: '' })).rejects.toThrow();
  });

  it('respects limit', async () => {
    const cmd = getRegistry().get('unimod/by-residue');
    const rows = unwrap(await cmd!.func!(makeCtx(), { residue: 'K', limit: 1 }));
    expect(rows.length).toBe(1);
  });

  // ── F3: case-insensitive N-term/C-term ───────────────────────────────────

  it('F3: matches N-term regardless of case (n-term, N-TERM, N-term)', async () => {
    const cmd = getRegistry().get('unimod/by-residue');
    for (const variant of ['n-term', 'N-term', 'N-TERM', 'n-TERM']) {
      const rows = unwrap(await cmd!.func!(makeCtx(), { residue: variant, position: 'Protein N-term' }));
      expect(rows.map(r => r.title)).toEqual(['Acetyl']);
      // queryResidue must be normalized to the canonical form
      expect(rows[0].queryResidue).toBe('N-term');
    }
  });
});
