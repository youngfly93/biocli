import { describe, expect, it, vi, beforeEach } from 'vitest';
import { getRegistry } from '../../registry.js';
import type { HttpContext } from '../../types.js';
import type { UnimodIndex, UnimodMod } from '../../datasets/unimod.js';
import { hasResultMeta } from '../../types.js';

const { loadUnimodMock } = vi.hoisted(() => ({ loadUnimodMock: vi.fn() }));

vi.mock('../../datasets/unimod.js', async (importOriginal) => {
  const actual = await importOriginal() as Record<string, unknown>;
  return {
    ...actual,
    loadUnimod: loadUnimodMock,
  };
});

import './list.js';

function makeCtx(): HttpContext {
  return {
    databaseId: 'unimod',
    fetch: async () => { throw new Error('should not be called'); },
    fetchXml: async () => { throw new Error('should not be called'); },
    fetchText: async () => { throw new Error('should not be called'); },
    fetchJson: async () => { throw new Error('should not be called'); },
  };
}

// ── Hand-built fake index ──────────────────────────────────────────────────

function mod(partial: Partial<UnimodMod> & { recordId: number; title: string; monoMass: number; specificities: UnimodMod['specificities'] }): UnimodMod {
  return {
    accession: `UNIMOD:${partial.recordId}`,
    fullName: partial.title,
    approved: true,
    avgMass: partial.monoMass,
    composition: '',
    altNames: [],
    xrefs: [],
    ...partial,
  };
}

const phospho = mod({
  recordId: 21,
  title: 'Phospho',
  fullName: 'Phosphorylation',
  monoMass: 79.966331,
  composition: 'H O(3) P',
  specificities: [
    { site: 'S', position: 'Anywhere', classification: 'Post-translational', hidden: false, neutralLossMono: 97.976896 },
    { site: 'T', position: 'Anywhere', classification: 'Post-translational', hidden: false, neutralLossMono: 97.976896 },
    { site: 'Y', position: 'Anywhere', classification: 'Post-translational', hidden: false },
    { site: 'K', position: 'Anywhere', classification: 'Post-translational', hidden: true },
  ],
});

const acetyl = mod({
  recordId: 1,
  title: 'Acetyl',
  fullName: 'Acetylation',
  monoMass: 42.010565,
  composition: 'H(2) C(2) O',
  specificities: [
    { site: 'K', position: 'Anywhere', classification: 'Multiple', hidden: false },
    { site: 'N-term', position: 'Protein N-term', classification: 'Post-translational', hidden: false },
    { site: 'C', position: 'Anywhere', classification: 'Post-translational', hidden: true },
  ],
});

const silac = mod({
  recordId: 188,
  title: 'Label:13C(6)',
  fullName: '13C(6) Silac label',
  monoMass: 6.020129,
  composition: 'C(-6) 13C(6)',
  specificities: [
    { site: 'K', position: 'Anywhere', classification: 'Isotopic label', hidden: true },
    { site: 'R', position: 'Anywhere', classification: 'Isotopic label', hidden: true },
  ],
});

const fakeIndex: UnimodIndex = {
  mods: [acetyl, phospho, silac],
  byRecordId: new Map([[1, acetyl], [21, phospho], [188, silac]]),
  byTitleLower: new Map([['acetyl', acetyl], ['phospho', phospho], ['label:13c(6)', silac]]),
  classifications: ['Isotopic label', 'Multiple', 'Post-translational'],
  sites: ['C', 'K', 'N-term', 'R', 'S', 'T', 'Y'],
  parseMeta: { source: 'test', fetchedAt: '2026-04-01T00:00:00Z', modCount: 3, staleAfterDays: 90 },
};

function unwrap(result: unknown): Record<string, unknown>[] {
  if (hasResultMeta(result)) return result.rows as Record<string, unknown>[];
  if (Array.isArray(result)) return result as Record<string, unknown>[];
  throw new Error('unexpected result shape');
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('unimod/list adapter', () => {
  beforeEach(() => {
    loadUnimodMock.mockReset();
    loadUnimodMock.mockResolvedValue(fakeIndex);
  });

  it('registers as unimod/list', () => {
    expect(getRegistry().get('unimod/list')).toBeDefined();
  });

  it('returns all visible mods with no filters', async () => {
    const cmd = getRegistry().get('unimod/list');
    const rows = unwrap(await cmd!.func!(makeCtx(), { limit: 50 }));
    // acetyl (K visible), phospho (S/T/Y visible); silac has ONLY hidden specificities
    // so by default (include-hidden=false) it should be filtered out.
    expect(rows.map(r => r.title).sort()).toEqual(['Acetyl', 'Phospho']);
  });

  it('filters by residue (uppercase)', async () => {
    const cmd = getRegistry().get('unimod/list');
    const rows = unwrap(await cmd!.func!(makeCtx(), { residue: 'S,T', limit: 50 }));
    // Only Phospho has S or T specificities (that are visible)
    expect(rows.map(r => r.title)).toEqual(['Phospho']);
    expect(rows[0].sites).toMatch(/S/);
    expect(rows[0].sites).toMatch(/T/);
    // Y is visible on Phospho but wasn't asked for — shouldn't appear in the joined sites
    expect(String(rows[0].sites).split(',').map(s => s.trim())).toEqual(['S', 'T']);
  });

  it('filters by position (case-insensitive)', async () => {
    const cmd = getRegistry().get('unimod/list');
    const rows = unwrap(await cmd!.func!(makeCtx(), { position: 'Protein N-term', limit: 50 }));
    expect(rows.map(r => r.title)).toEqual(['Acetyl']);
  });

  it('filters by classification (case-insensitive)', async () => {
    const cmd = getRegistry().get('unimod/list');
    const rows = unwrap(await cmd!.func!(makeCtx(), { classification: 'Multiple', limit: 50 }));
    expect(rows.map(r => r.title)).toEqual(['Acetyl']);
  });

  it('include-hidden surfaces SILAC', async () => {
    const cmd = getRegistry().get('unimod/list');
    const rows = unwrap(await cmd!.func!(makeCtx(), { 'include-hidden': true, classification: 'Isotopic label', limit: 50 }));
    expect(rows.map(r => r.title)).toEqual(['Label:13C(6)']);
  });

  it('respects the limit', async () => {
    const cmd = getRegistry().get('unimod/list');
    const rows = unwrap(await cmd!.func!(makeCtx(), { limit: 1 }));
    expect(rows.length).toBe(1);
  });

  it('returns accession in UNIMOD:<n> format', async () => {
    const cmd = getRegistry().get('unimod/list');
    const rows = unwrap(await cmd!.func!(makeCtx(), { residue: 'K', limit: 50 }));
    expect(rows.find(r => r.title === 'Acetyl')?.accession).toBe('UNIMOD:1');
  });
});
