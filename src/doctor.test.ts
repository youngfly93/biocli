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
import chalk from 'chalk';
import { runDoctor, formatDoctorJson, formatDoctorText, PING_ENDPOINTS } from './doctor.js';

interface CheckResult {
  name: string;
  value: string;
  ok: boolean;
  detail?: string;
  stale?: boolean;
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

  /** Helper: install both meta + xml together (the only valid state). */
  function installBoth(opts: { fetchedAt?: string; modCount?: number; staleAfterDays?: number } = {}): void {
    mkdirSync(tempDir, { recursive: true });
    writeFileSync(join(tempDir, 'unimod.xml'), '<?xml version="1.0"?><dummy/>');
    writeFileSync(
      join(tempDir, 'unimod.meta.json'),
      JSON.stringify({
        source: 'test',
        fetchedAt: opts.fetchedAt ?? new Date().toISOString(),
        modCount: opts.modCount ?? 1560,
        staleAfterDays: opts.staleAfterDays ?? 90,
      }),
    );
  }

  it('reports "not installed" when neither meta nor xml exists (ok: true)', async () => {
    const { checks } = await runDoctor();
    const check = findUnimodCheck(checks);
    expect(check.value).toBe('not installed');
    expect(check.ok).toBe(true);
    expect(check.detail).toMatch(/biocli unimod install/);
  });

  it('reports fresh install (age 0, ok: true, stale: false)', async () => {
    installBoth();
    const { checks } = await runDoctor();
    const check = findUnimodCheck(checks);
    expect(check.value).toBe('1560 mods');
    expect(check.ok).toBe(true);
    expect(check.stale).toBeFalsy();
    expect(check.detail).toMatch(/0d old|1d old/);
  });

  it('marks stale when age > staleAfterDays (ok: true, stale: true)', async () => {
    installBoth({
      fetchedAt: new Date(Date.now() - 200 * 86_400_000).toISOString(),
      staleAfterDays: 90,
    });
    const { checks } = await runDoctor();
    const check = findUnimodCheck(checks);
    expect(check.ok).toBe(true);
    expect(check.stale).toBe(true);
    expect(check.detail).toMatch(/stale/);
    // F4: no ANSI escape codes leaked into the data layer.
    expect(check.detail).not.toMatch(/\u001b\[/);
  });

  // ── F2: corrupt install detection ─────────────────────────────────────────

  it('F2: reports "corrupt install" when xml exists but meta.json is missing', async () => {
    mkdirSync(tempDir, { recursive: true });
    writeFileSync(join(tempDir, 'unimod.xml'), '<?xml version="1.0"?><dummy/>');
    const { checks } = await runDoctor();
    const check = findUnimodCheck(checks);
    expect(check.ok).toBe(false);
    expect(check.value).toBe('corrupt install');
    expect(check.detail).toMatch(/unimod\.meta\.json.*missing/);
    expect(check.detail).toMatch(/refresh/);
  });

  it('F2: reports "corrupt install" when meta.json exists but xml is missing', async () => {
    mkdirSync(tempDir, { recursive: true });
    writeFileSync(
      join(tempDir, 'unimod.meta.json'),
      JSON.stringify({ fetchedAt: new Date().toISOString(), modCount: 1560 }),
    );
    const { checks } = await runDoctor();
    const check = findUnimodCheck(checks);
    expect(check.ok).toBe(false);
    expect(check.value).toBe('corrupt install');
    expect(check.detail).toMatch(/unimod\.xml.*missing/);
    expect(check.detail).toMatch(/refresh/);
  });

  // ── F4: ANSI must NOT leak into JSON output ──────────────────────────────

  it('F4: formatDoctorJson contains no ANSI escapes even when stale', async () => {
    installBoth({
      fetchedAt: new Date(Date.now() - 200 * 86_400_000).toISOString(),
      staleAfterDays: 90,
    });
    const { checks, allPassed } = await runDoctor();
    const json = formatDoctorJson(checks, allPassed);
    expect(json).not.toMatch(/\u001b\[/);
    // The structured stale flag IS present so consumers can react.
    const parsed = JSON.parse(json);
    const unimod = parsed.checks.find((c: { name: string }) => c.name === 'Unimod');
    expect(unimod.stale).toBe(true);
  });

  it('F4: formatDoctorText applies yellow to stale detail', async () => {
    installBoth({
      fetchedAt: new Date(Date.now() - 200 * 86_400_000).toISOString(),
      staleAfterDays: 90,
    });
    // chalk caches its level at import time; FORCE_COLOR env var is too late.
    // Override the level on the imported instance directly.
    const prevLevel = chalk.level;
    chalk.level = 3;
    try {
      const { checks, allPassed } = await runDoctor();
      const text = formatDoctorText(checks, allPassed);
      expect(text).toMatch(/\u001b\[33m/);
      expect(text).toMatch(/stale/);
    } finally {
      chalk.level = prevLevel;
    }
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

describe('doctor ping endpoint configuration', () => {
  it('uses a real GraphQL POST probe for Open Targets', () => {
    expect(PING_ENDPOINTS.opentargets).toEqual({
      url: 'https://api.platform.opentargets.org/api/v4/graphql',
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'accept': 'application/json',
      },
      body: JSON.stringify({ query: 'query Ping { __typename }' }),
    });
  });

  it('uses a stable static asset probe for GDSC', () => {
    expect(PING_ENDPOINTS.gdsc?.url).toContain('/GDSC_release8.5/screened_compounds_rel_8.5.csv');
  });
});
