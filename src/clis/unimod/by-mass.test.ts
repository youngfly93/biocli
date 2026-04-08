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

import './by-mass.js';

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
  return {
    site,
    position: 'Anywhere',
    classification: 'Post-translational',
    hidden: false,
    ...opts,
  };
}

function mod(
  recordId: number,
  title: string,
  monoMass: number,
  avgMass: number,
  specificities: UnimodSpecificity[],
): UnimodMod {
  return {
    recordId,
    accession: `UNIMOD:${recordId}`,
    title,
    fullName: title,
    approved: true,
    monoMass,
    avgMass,
    composition: '',
    specificities,
    altNames: [],
    xrefs: [],
  };
}

const phospho = mod(21, 'Phospho', 79.966331, 79.9799, [
  spec('S'), spec('T'), spec('Y'),
  spec('C', { hidden: true }), spec('D', { hidden: true }),
  spec('E', { hidden: true }), spec('H', { hidden: true }),
  spec('K', { hidden: true }), spec('R', { hidden: true }),
]);
const sulfo = mod(40, 'Sulfo', 79.956815, 80.0632, [
  spec('S'), spec('T'), spec('Y'),
]);
const hexnac = mod(43, 'HexNAc', 203.079373, 203.1925, [
  spec('N', { classification: 'N-linked glycosylation', hidden: true }),
  spec('S', { classification: 'O-linked glycosylation', hidden: true }),
  spec('T', { classification: 'O-linked glycosylation', hidden: true }),
]);
const acetyl = mod(1, 'Acetyl', 42.010565, 42.0367, [
  spec('K'),
  spec('N-term', { position: 'Protein N-term' }),
]);
// Negative-mass mods are real: Dehydrated = water loss; Ammonia-loss = -NH3.
const dehydrated = mod(23, 'Dehydrated', -18.010565, -18.0153, [
  spec('S'), spec('T'), spec('Y'), spec('D', { hidden: true }),
]);
const ammoniaLoss = mod(385, 'Ammonia-loss', -17.026549, -17.0305, [
  spec('N'), spec('Q'),
]);

const fakeIndex: UnimodIndex = {
  mods: [acetyl, phospho, sulfo, hexnac, dehydrated, ammoniaLoss],
  byRecordId: new Map([[1, acetyl], [21, phospho], [40, sulfo], [43, hexnac], [23, dehydrated], [385, ammoniaLoss]]),
  byTitleLower: new Map(),
  classifications: [],
  sites: [],
  parseMeta: { source: 'test', fetchedAt: '2026-04-01T00:00:00Z', modCount: 6, staleAfterDays: 90 },
};

function unwrap(result: unknown): Record<string, unknown>[] {
  if (hasResultMeta(result)) return result.rows as Record<string, unknown>[];
  throw new Error('expected ResultWithMeta');
}

describe('unimod/by-mass adapter', () => {
  beforeEach(() => {
    loadUnimodMock.mockReset();
    loadUnimodMock.mockResolvedValue(fakeIndex);
  });

  it('registers as unimod/by-mass', () => {
    expect(getRegistry().get('unimod/by-mass')).toBeDefined();
  });

  it('matches Phospho on S/T/Y within ±0.01 Da (3 rows, one per visible specificity)', async () => {
    const cmd = getRegistry().get('unimod/by-mass');
    const rows = unwrap(await cmd!.func!(makeCtx(), { mass: 79.9663, tolerance: 0.01 }));
    const phosphoRows = rows.filter(r => r.accession === 'UNIMOD:21');
    // Default excludes hidden specificities, so only S, T, Y should appear.
    expect(phosphoRows.length).toBe(3);
    const sites = phosphoRows.map(r => r.site).sort();
    expect(sites).toEqual(['S', 'T', 'Y']);
    // Every Phospho row carries correlation fields
    for (const r of phosphoRows) {
      expect(r.queryMass).toBe(79.9663);
      expect(r.queryTolerance).toBe(0.01);
      expect(r.queryToleranceUnit).toBe('Da');
      expect(typeof r.rank).toBe('number');
    }
  });

  it('also matches Sulfo (79.956815) within 0.01 Da of 79.9663', async () => {
    const cmd = getRegistry().get('unimod/by-mass');
    const rows = unwrap(await cmd!.func!(makeCtx(), { mass: 79.9663, tolerance: 0.01 }));
    const titles = new Set(rows.map(r => r.title));
    expect(titles.has('Phospho')).toBe(true);
    expect(titles.has('Sulfo')).toBe(true);
  });

  it('Phospho (closer) ranks ahead of Sulfo (further)', async () => {
    const cmd = getRegistry().get('unimod/by-mass');
    const rows = unwrap(await cmd!.func!(makeCtx(), { mass: 79.9663, tolerance: 0.01 }));
    const phosphoRank = rows.find(r => r.title === 'Phospho')!.rank;
    const sulfoRank = rows.find(r => r.title === 'Sulfo')!.rank;
    expect(phosphoRank).toBeLessThan(sulfoRank as number);
  });

  it('restricts by residue', async () => {
    const cmd = getRegistry().get('unimod/by-mass');
    const rows = unwrap(await cmd!.func!(makeCtx(), { mass: 79.9663, tolerance: 0.01, residue: 'Y' }));
    const sites = rows.map(r => r.site);
    expect(sites.every(s => s === 'Y')).toBe(true);
    expect(sites.length).toBeGreaterThan(0);
  });

  it('ppm tolerance works: 50 ppm ≈ 0.004 Da at mass 80', async () => {
    const cmd = getRegistry().get('unimod/by-mass');
    // Phospho is at 79.966331, query 79.966 → delta 0.000331 → well within 50 ppm ≈ 0.004
    const rows = unwrap(await cmd!.func!(makeCtx(), { mass: 79.966, tolerance: 50, 'tolerance-unit': 'ppm' }));
    expect(rows.some(r => r.title === 'Phospho')).toBe(true);
    // Every row should record the unit
    expect(rows.every(r => r.queryToleranceUnit === 'ppm')).toBe(true);
  });

  it('ppm tolerance is tight enough to exclude Sulfo at high precision', async () => {
    const cmd = getRegistry().get('unimod/by-mass');
    // Phospho 79.966331, Sulfo 79.956815, delta = 0.009516 Da = ~119 ppm at mass 80
    // A 50 ppm tolerance should catch Phospho but miss Sulfo.
    const rows = unwrap(await cmd!.func!(makeCtx(), { mass: 79.966331, tolerance: 50, 'tolerance-unit': 'ppm' }));
    expect(rows.some(r => r.title === 'Phospho')).toBe(true);
    expect(rows.every(r => r.title !== 'Sulfo')).toBe(true);
  });

  it('classification filter excludes non-matching classes', async () => {
    const cmd = getRegistry().get('unimod/by-mass');
    // HexNAc at 203.079373 has multiple classifications; ask only for N-linked.
    const rows = unwrap(await cmd!.func!(makeCtx(), {
      mass: 203.079373,
      tolerance: 0.001,
      classification: 'N-linked glycosylation',
      'include-hidden': true,
    }));
    const classifications = new Set(rows.map(r => r.classification));
    expect(classifications).toEqual(new Set(['N-linked glycosylation']));
    expect(rows.length).toBe(1); // only the N-linked specificity on N
  });

  it('deltaFromQuery is signed (mod - query)', async () => {
    const cmd = getRegistry().get('unimod/by-mass');
    // Sulfo mono 79.956815, query 79.966 → delta = -0.009185 (negative)
    const rows = unwrap(await cmd!.func!(makeCtx(), { mass: 79.966, tolerance: 0.05 }));
    const sulfoRow = rows.find(r => r.title === 'Sulfo')!;
    expect(sulfoRow.deltaFromQuery as number).toBeLessThan(0);
    const phosphoRow = rows.find(r => r.title === 'Phospho')!;
    // Phospho 79.966331, query 79.966 → positive delta
    expect(phosphoRow.deltaFromQuery as number).toBeGreaterThan(0);
  });

  it('limit trims total rows but ranks 1..N within output', async () => {
    const cmd = getRegistry().get('unimod/by-mass');
    const rows = unwrap(await cmd!.func!(makeCtx(), { mass: 79.9663, tolerance: 0.05, limit: 2 }));
    expect(rows.length).toBe(2);
    expect(rows.map(r => r.rank)).toEqual([1, 2]);
  });

  it('rejects only non-finite mass or non-positive tolerance (negative mass is VALID)', async () => {
    const cmd = getRegistry().get('unimod/by-mass');
    await expect(cmd!.func!(makeCtx(), { mass: 'abc' })).rejects.toThrow();
    await expect(cmd!.func!(makeCtx(), { mass: NaN })).rejects.toThrow();
    await expect(cmd!.func!(makeCtx(), { mass: 79.966, tolerance: 0 })).rejects.toThrow();
    await expect(cmd!.func!(makeCtx(), { mass: 79.966, tolerance: -1 })).rejects.toThrow();
  });

  it('finds Dehydrated (-18.010565) for a negative query mass', async () => {
    const cmd = getRegistry().get('unimod/by-mass');
    const rows = unwrap(await cmd!.func!(makeCtx(), { mass: -18.0106, tolerance: 0.001 }));
    const titles = new Set(rows.map(r => r.title));
    expect(titles.has('Dehydrated')).toBe(true);
    // Every row carries the (negative) queryMass correctly
    for (const r of rows) {
      expect(r.queryMass).toBe(-18.0106);
    }
  });

  it('positive 18.0106 does NOT match Dehydrated (-18.0106) — sign matters', async () => {
    const cmd = getRegistry().get('unimod/by-mass');
    const rows = unwrap(await cmd!.func!(makeCtx(), { mass: 18.0106, tolerance: 0.001 }));
    expect(rows.every(r => r.title !== 'Dehydrated')).toBe(true);
  });

  it('finds Ammonia-loss (-17.026549) for query -17.0265', async () => {
    const cmd = getRegistry().get('unimod/by-mass');
    const rows = unwrap(await cmd!.func!(makeCtx(), { mass: -17.0265, tolerance: 0.001 }));
    expect(rows.some(r => r.title === 'Ammonia-loss')).toBe(true);
  });

  it('ppm tolerance works for negative masses (uses |queryMass| for window)', async () => {
    const cmd = getRegistry().get('unimod/by-mass');
    // Dehydrated mono = -18.010565, query = -18.0106, delta ≈ 3.5e-5
    // 10 ppm of |18| ≈ 1.8e-4 → should match
    const rows = unwrap(await cmd!.func!(makeCtx(), { mass: -18.0106, tolerance: 10, 'tolerance-unit': 'ppm' }));
    expect(rows.some(r => r.title === 'Dehydrated')).toBe(true);
  });

  it('allows mass=0 (no-op but not rejected)', async () => {
    const cmd = getRegistry().get('unimod/by-mass');
    await expect(cmd!.func!(makeCtx(), { mass: 0, tolerance: 0.001 })).resolves.toBeDefined();
  });

  it('uses avg mass when --mass-type avg', async () => {
    const cmd = getRegistry().get('unimod/by-mass');
    // Sulfo avgMass is 80.0632 — match around there
    const rows = unwrap(await cmd!.func!(makeCtx(), { mass: 80.06, tolerance: 0.01, 'mass-type': 'avg' }));
    expect(rows.some(r => r.title === 'Sulfo')).toBe(true);
  });

  it('matchingSpecificities uses the filter when computing rows', async () => {
    // Phospho hidden specificities (C, D, E, H, K, R) should NOT appear by default
    const cmd = getRegistry().get('unimod/by-mass');
    const rows = unwrap(await cmd!.func!(makeCtx(), { mass: 79.9663, tolerance: 0.01 }));
    const phosphoSites = rows.filter(r => r.title === 'Phospho').map(r => r.site);
    expect(phosphoSites).not.toContain('K');
    expect(phosphoSites).not.toContain('C');
  });

  it('include-hidden surfaces all 9 Phospho specificities', async () => {
    const cmd = getRegistry().get('unimod/by-mass');
    const rows = unwrap(await cmd!.func!(makeCtx(), { mass: 79.9663, tolerance: 0.01, 'include-hidden': true, limit: 50 }));
    const phosphoSites = new Set(rows.filter(r => r.title === 'Phospho').map(r => r.site));
    expect(phosphoSites.size).toBe(9);
  });

  // ── F3: case-insensitive --residue for N-term and AA letters ─────────────

  it('F3: --residue accepts lowercase single AAs', async () => {
    const cmd = getRegistry().get('unimod/by-mass');
    const rows = unwrap(await cmd!.func!(makeCtx(), { mass: 79.9663, tolerance: 0.01, residue: 's,t,y' }));
    const sites = new Set(rows.filter(r => r.title === 'Phospho').map(r => r.site));
    expect(sites).toEqual(new Set(['S', 'T', 'Y']));
  });
});
