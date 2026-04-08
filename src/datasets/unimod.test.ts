import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import {
  parseUnimodXml,
  loadUnimod,
  unimodPaths,
  _resetUnimodSingleton,
  DEFAULT_STALE_AFTER_DAYS,
  type UnimodParseMeta,
} from './unimod.js';
import { CliError } from '../errors.js';

// ── Fixture helpers ─────────────────────────────────────────────────────────

const FIXTURE_DIR = join(dirname(fileURLToPath(import.meta.url)), '__fixtures__');
const FIXTURE_PATH = join(FIXTURE_DIR, 'unimod-sample.xml');

function loadFixture(): string {
  return readFileSync(FIXTURE_PATH, 'utf-8');
}

// ── Fixture invariant ───────────────────────────────────────────────────────

describe('unimod fixture', () => {
  it('is trimmed to <20 KB so no full dump gets committed by accident', () => {
    const bytes = readFileSync(FIXTURE_PATH).length;
    expect(bytes).toBeLessThan(20_000);
    expect(bytes).toBeGreaterThan(5_000);
  });
});

// ── Parser tests ────────────────────────────────────────────────────────────

describe('parseUnimodXml', () => {
  const xml = loadFixture();
  const idx = parseUnimodXml(xml, 'test://unimod-sample.xml');

  it('parses all 5 fixture modifications', () => {
    expect(idx.mods.length).toBe(5);
    expect(idx.parseMeta.modCount).toBe(5);
    expect(idx.parseMeta.source).toBe('test://unimod-sample.xml');
  });

  it('indexes by record id', () => {
    expect(idx.byRecordId.get(21)?.title).toBe('Phospho');
    expect(idx.byRecordId.get(1)?.title).toBe('Acetyl');
    expect(idx.byRecordId.get(188)?.title).toBe('Label:13C(6)');
    expect(idx.byRecordId.get(9999)).toBeUndefined();
  });

  it('indexes by lowercased title', () => {
    expect(idx.byTitleLower.get('phospho')?.recordId).toBe(21);
    expect(idx.byTitleLower.get('hexnac')?.recordId).toBe(43);
  });

  it('formats accession as UNIMOD:<recordId>', () => {
    const phospho = idx.byRecordId.get(21)!;
    expect(phospho.accession).toBe('UNIMOD:21');
  });

  it('extracts delta mono/avg mass and composition', () => {
    const phospho = idx.byRecordId.get(21)!;
    expect(phospho.monoMass).toBeCloseTo(79.966331, 6);
    expect(phospho.avgMass).toBeCloseTo(79.9799, 4);
    expect(phospho.composition).toBe('H O(3) P');
  });

  it('preserves all 9 Phospho specificities (including hidden ones)', () => {
    const phospho = idx.byRecordId.get(21)!;
    expect(phospho.specificities.length).toBe(9);
    const sites = phospho.specificities.map(s => s.site).sort();
    expect(sites).toEqual(['C', 'D', 'E', 'H', 'K', 'R', 'S', 'T', 'Y']);
  });

  it('preserves the hidden flag correctly', () => {
    const phospho = idx.byRecordId.get(21)!;
    const bySite = new Map(phospho.specificities.map(s => [s.site, s]));
    // S, T, Y are visible (hidden=0)
    expect(bySite.get('S')!.hidden).toBe(false);
    expect(bySite.get('T')!.hidden).toBe(false);
    expect(bySite.get('Y')!.hidden).toBe(false);
    // C, D, E, H, K, R are hidden
    expect(bySite.get('C')!.hidden).toBe(true);
    expect(bySite.get('H')!.hidden).toBe(true);
  });

  it('extracts the primary neutral loss (skipping zero-mass placeholders)', () => {
    const phospho = idx.byRecordId.get(21)!;
    const bySite = new Map(phospho.specificities.map(s => [s.site, s]));
    // Both S and T have H(3) O(4) P neutral loss at mono=97.976896
    expect(bySite.get('S')!.neutralLossMono).toBeCloseTo(97.976896, 6);
    expect(bySite.get('S')!.neutralLossComposition).toBe('H(3) O(4) P');
    expect(bySite.get('T')!.neutralLossMono).toBeCloseTo(97.976896, 6);
    // Y has no neutral loss
    expect(bySite.get('Y')!.neutralLossMono).toBeUndefined();
  });

  it('discovers all classifications in the dataset', () => {
    expect(idx.classifications).toContain('Post-translational');
    expect(idx.classifications).toContain('Chemical derivative');
    expect(idx.classifications).toContain('Isotopic label');
    expect(idx.classifications).toContain('O-linked glycosylation');
    expect(idx.classifications).toContain('N-linked glycosylation');
    expect(idx.classifications).toContain('Multiple');
    // Should be sorted
    const sorted = [...idx.classifications].sort();
    expect(idx.classifications).toEqual(sorted);
  });

  it('discovers all sites in the dataset', () => {
    expect(idx.sites).toContain('S');
    expect(idx.sites).toContain('T');
    expect(idx.sites).toContain('N-term');
    expect(idx.sites).toContain('K');
    // Should be sorted
    const sorted = [...idx.sites].sort();
    expect(idx.sites).toEqual(sorted);
  });

  it('captures N-term positions beyond plain Anywhere', () => {
    const acetyl = idx.byRecordId.get(1)!;
    const positions = new Set(acetyl.specificities.map(s => s.position));
    expect(positions.has('Protein N-term')).toBe(true);
    expect(positions.has('Any N-term')).toBe(true);
    expect(positions.has('Anywhere')).toBe(true);
  });

  it('preserves alt_names', () => {
    const hpg = idx.byRecordId.get(186)!;
    expect(hpg.altNames).toEqual(['HPG arginine']);

    const silac = idx.byRecordId.get(188)!;
    expect(silac.altNames).toEqual(['SILAC heavy K+R', 'Heavy carbon label']);

    // Phospho has no alt_name
    expect(idx.byRecordId.get(21)!.altNames).toEqual([]);
  });

  it('preserves xrefs with source + text', () => {
    const hpg = idx.byRecordId.get(186)!;
    expect(hpg.xrefs.length).toBe(2);
    expect(hpg.xrefs.every(x => x.source === 'PubMed PMID')).toBe(true);
    expect(hpg.xrefs.map(x => x.text).sort()).toEqual(['11698400', '11914093']);
  });

  it('handles HexNAc multi-glycosylation classifications', () => {
    const hexnac = idx.byRecordId.get(43)!;
    expect(hexnac.specificities.length).toBe(4);
    const classifications = new Set(hexnac.specificities.map(s => s.classification));
    expect(classifications.has('N-linked glycosylation')).toBe(true);
    expect(classifications.has('O-linked glycosylation')).toBe(true);
    expect(classifications.has('Other glycosylation')).toBe(true);
    // All HexNAc specificities carry the 203.079373 neutral loss
    for (const spec of hexnac.specificities) {
      expect(spec.neutralLossMono).toBeCloseTo(203.079373, 6);
    }
  });

  it('marks approved modifications correctly', () => {
    expect(idx.byRecordId.get(21)!.approved).toBe(true);
    expect(idx.byRecordId.get(1)!.approved).toBe(true);
  });

  it('throws on empty input', () => {
    expect(() => parseUnimodXml('')).toThrow();
  });
});

// ── Loader tests (via BIOCLI_DATASETS_DIR override) ─────────────────────────

describe('loadUnimod', () => {
  let tempDir: string;
  const savedEnv = process.env.BIOCLI_DATASETS_DIR;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'biocli-unimod-test-'));
    process.env.BIOCLI_DATASETS_DIR = tempDir;
    _resetUnimodSingleton();
  });

  afterEach(() => {
    if (savedEnv === undefined) {
      delete process.env.BIOCLI_DATASETS_DIR;
    } else {
      process.env.BIOCLI_DATASETS_DIR = savedEnv;
    }
    _resetUnimodSingleton();
    try { rmSync(tempDir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  function installFixture(meta?: Partial<UnimodParseMeta>): UnimodParseMeta {
    const paths = unimodPaths();
    mkdirSync(paths.dir, { recursive: true });
    writeFileSync(paths.xml, readFileSync(FIXTURE_PATH));
    const full: UnimodParseMeta = {
      source: 'test://fixture',
      fetchedAt: new Date().toISOString(),
      modCount: 5,
      staleAfterDays: DEFAULT_STALE_AFTER_DAYS,
      ...meta,
    };
    writeFileSync(paths.meta, JSON.stringify(full, null, 2));
    return full;
  }

  it('throws MISSING_DATASET when nothing is installed', async () => {
    await expect(loadUnimod()).rejects.toBeInstanceOf(CliError);
    await expect(loadUnimod()).rejects.toHaveProperty('code', 'MISSING_DATASET');
  });

  it('loads the fixture when meta + xml exist', async () => {
    installFixture();
    const idx = await loadUnimod();
    expect(idx.mods.length).toBe(5);
    expect(idx.byRecordId.get(21)?.title).toBe('Phospho');
  });

  it('carries meta.fetchedAt through to parseMeta (not "now")', async () => {
    const past = new Date('2020-01-01T00:00:00Z').toISOString();
    installFixture({ fetchedAt: past });
    const idx = await loadUnimod();
    expect(idx.parseMeta.fetchedAt).toBe(past);
  });

  it('emits stderr warning when cache is stale', async () => {
    const longAgo = new Date(Date.now() - 200 * 86_400_000).toISOString();
    installFixture({ fetchedAt: longAgo, staleAfterDays: 30 });
    const errSpy: string[] = [];
    const original = console.error;
    console.error = (msg: unknown) => { errSpy.push(String(msg)); };
    try {
      const idx = await loadUnimod();
      expect(idx.mods.length).toBe(5);
      expect(errSpy.some(m => m.includes('stale') || m.includes('Unimod cache'))).toBe(true);
    } finally {
      console.error = original;
    }
  });

  it('memoizes the result (second call does not re-read)', async () => {
    installFixture();
    const a = await loadUnimod();
    const b = await loadUnimod();
    expect(a).toBe(b);
  });

  it('does not pin a rejected promise on transient failure', async () => {
    // First call: no dataset installed → fails
    await expect(loadUnimod()).rejects.toBeInstanceOf(CliError);
    // Install it
    installFixture();
    // Second call should succeed (singleton was reset on the first failure)
    const idx = await loadUnimod();
    expect(idx.mods.length).toBe(5);
  });

  it('honors BIOCLI_DATASETS_DIR for the path resolver', () => {
    const paths = unimodPaths();
    expect(paths.dir).toBe(tempDir);
    expect(paths.xml).toBe(join(tempDir, 'unimod.xml'));
    expect(paths.meta).toBe(join(tempDir, 'unimod.meta.json'));
  });

  it('throws MISSING_DATASET if meta exists but xml is gone', async () => {
    installFixture();
    const paths = unimodPaths();
    rmSync(paths.xml);
    expect(existsSync(paths.meta)).toBe(true);
    expect(existsSync(paths.xml)).toBe(false);
    await expect(loadUnimod()).rejects.toHaveProperty('code', 'MISSING_DATASET');
  });
});
