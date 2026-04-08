/**
 * Focused tests for the Unimod dataset check in `biocli doctor`.
 *
 * We don't exercise the full runDoctor() here (it pings real backends).
 * Instead we verify checkUnimodDataset() by setting BIOCLI_DATASETS_DIR
 * to a temp dir and writing fake meta.json files.
 */

import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { runDoctor } from './doctor.js';

interface CheckResult {
  name: string;
  value: string;
  ok: boolean;
  detail?: string;
}

function findUnimodCheck(checks: CheckResult[]): CheckResult {
  const found = checks.find(c => c.name === 'Unimod');
  if (!found) throw new Error('Unimod check missing from doctor output');
  return found;
}

describe('checkUnimodDataset via runDoctor', () => {
  let tempDir: string;
  const savedEnv = process.env.BIOCLI_DATASETS_DIR;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'biocli-doctor-test-'));
    process.env.BIOCLI_DATASETS_DIR = tempDir;
  });

  afterEach(() => {
    if (savedEnv === undefined) delete process.env.BIOCLI_DATASETS_DIR;
    else process.env.BIOCLI_DATASETS_DIR = savedEnv;
    try { rmSync(tempDir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  it('reports "not installed" when meta.json is missing (ok: true)', async () => {
    const { checks } = await runDoctor();
    const check = findUnimodCheck(checks);
    expect(check.value).toBe('not installed');
    expect(check.ok).toBe(true);
    expect(check.detail).toMatch(/biocli unimod fetch/);
  });

  it('reports fresh install (age 0, ok: true)', async () => {
    mkdirSync(tempDir, { recursive: true });
    writeFileSync(
      join(tempDir, 'unimod.meta.json'),
      JSON.stringify({
        source: 'test',
        fetchedAt: new Date().toISOString(),
        modCount: 1560,
        staleAfterDays: 90,
      }),
    );
    const { checks } = await runDoctor();
    const check = findUnimodCheck(checks);
    expect(check.value).toBe('1560 mods');
    expect(check.ok).toBe(true);
    expect(check.detail).toMatch(/0d old|1d old/);
  });

  it('marks stale when age > staleAfterDays (still ok: true, yellow detail)', async () => {
    mkdirSync(tempDir, { recursive: true });
    const oldDate = new Date(Date.now() - 200 * 86_400_000).toISOString();
    writeFileSync(
      join(tempDir, 'unimod.meta.json'),
      JSON.stringify({
        source: 'test',
        fetchedAt: oldDate,
        modCount: 1560,
        staleAfterDays: 90,
      }),
    );
    const { checks } = await runDoctor();
    const check = findUnimodCheck(checks);
    expect(check.ok).toBe(true); // stale is not a failure
    expect(check.detail).toMatch(/stale/);
    expect(check.detail).toMatch(/refresh/);
  });

  it('reports corrupt meta.json as ok: false', async () => {
    mkdirSync(tempDir, { recursive: true });
    writeFileSync(join(tempDir, 'unimod.meta.json'), '{ not valid json');
    const { checks } = await runDoctor();
    const check = findUnimodCheck(checks);
    expect(check.ok).toBe(false);
    expect(check.value).toMatch(/corrupt/i);
  });

  it('reports missing fetchedAt as ok: false', async () => {
    mkdirSync(tempDir, { recursive: true });
    writeFileSync(
      join(tempDir, 'unimod.meta.json'),
      JSON.stringify({ modCount: 100 }),
    );
    const { checks } = await runDoctor();
    const check = findUnimodCheck(checks);
    expect(check.ok).toBe(false);
  });
});
