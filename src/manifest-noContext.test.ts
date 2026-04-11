/**
 * Round-trip test for the `noContext` flag through the manifest pipeline.
 *
 * This is the regression test for the bug found by the v2 review:
 * `noContext` was added to CliCommand for runtime exemption from the
 * HttpContext factory and the response cache, but it was NOT propagated
 * through manifest serialization. After `npm run build`, the lazy stub
 * created by discovery.ts:loadFromManifest had `noContext: undefined`,
 * which made executeCommand() (a) build a wrong NCBI ctx and (b) write
 * the result into ~/.biocli/cache/unimod/...
 *
 * This test exercises the full chain in-process so the bug cannot
 * silently regress: register a noContext command → serialize to a
 * fake manifest in a temp dir → run the same loader path used in
 * production → assert the resulting registry entry still has
 * `noContext === true`.
 */

import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { discoverClis } from './discovery.js';
import { getRegistry } from './registry.js';
import type { CliCommand } from './registry.js';
import type { ManifestEntry } from './build-manifest.js';

describe('noContext propagation through manifest (F5 regression)', () => {
  let tempRoot: string;
  let clisDir: string;
  let manifestPath: string;
  const REGISTRY_KEY = 'snapshotsite/list';
  let savedCmd: CliCommand | undefined;

  beforeEach(() => {
    tempRoot = mkdtempSync(join(tmpdir(), 'biocli-manifest-test-'));
    // Manifest must live at <parent>/cli-manifest.json relative to clisDir.
    clisDir = join(tempRoot, 'clis');
    manifestPath = join(tempRoot, 'cli-manifest.json');
    mkdirSync(clisDir, { recursive: true });
    // Snapshot any pre-existing entry under our test key so we don't
    // pollute other tests in the same vitest worker.
    savedCmd = getRegistry().get(REGISTRY_KEY);
    getRegistry().delete(REGISTRY_KEY);
  });

  afterEach(() => {
    getRegistry().delete(REGISTRY_KEY);
    if (savedCmd) getRegistry().set(REGISTRY_KEY, savedCmd);
    try { rmSync(tempRoot, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  it('a TS-style manifest entry with noContext:true survives round-trip', async () => {
    const entry: ManifestEntry = {
      site: 'snapshotsite',
      name: 'list',
      description: 'a snapshot dataset list command',
      database: 'snapshotsite',
      strategy: 'public',
      args: [],
      defaultFormat: 'json',
      requiredEnv: [{ name: 'BIOCLI_TEST_TOKEN', help: 'Set for test snapshots.' }],
      examples: [{ goal: 'List snapshot records', command: 'biocli snapshotsite list -f json' }],
      noContext: true,
      type: 'ts',
      modulePath: 'snapshotsite/list.js',
    };
    writeFileSync(manifestPath, JSON.stringify([entry]));
    // Create the stub TS file the lazy loader will reference (it's only
    // touched if the command is executed; for this test we just assert
    // the registry stub).
    mkdirSync(join(clisDir, 'snapshotsite'));
    writeFileSync(join(clisDir, 'snapshotsite', 'list.js'), '// stub\n');

    await discoverClis(clisDir);
    const cmd = getRegistry().get(REGISTRY_KEY);
    expect(cmd).toBeDefined();
    expect(cmd?.noContext).toBe(true);
    expect(cmd?.defaultFormat).toBe('json');
    expect(cmd?.requiredEnv).toEqual([{ name: 'BIOCLI_TEST_TOKEN', help: 'Set for test snapshots.' }]);
    expect(cmd?.examples).toEqual([{ goal: 'List snapshot records', command: 'biocli snapshotsite list -f json' }]);
  });

  it('a TS-style manifest entry WITHOUT noContext stays undefined (no spurious flag)', async () => {
    const entry: ManifestEntry = {
      site: 'snapshotsite',
      name: 'list',
      description: 'a normal command',
      database: 'pubmed',
      strategy: 'public',
      args: [],
      type: 'ts',
      modulePath: 'snapshotsite/list.js',
    };
    writeFileSync(manifestPath, JSON.stringify([entry]));
    mkdirSync(join(clisDir, 'snapshotsite'));
    writeFileSync(join(clisDir, 'snapshotsite', 'list.js'), '// stub\n');

    await discoverClis(clisDir);
    const cmd = getRegistry().get(REGISTRY_KEY);
    expect(cmd).toBeDefined();
    expect(cmd?.noContext).toBeUndefined();
  });

  it('YAML-style manifest entries also propagate noContext', async () => {
    const entry: ManifestEntry = {
      site: 'snapshotsite',
      name: 'list',
      description: 'a yaml snapshot dataset',
      database: 'snapshotsite',
      strategy: 'public',
      args: [],
      pipeline: [{ select: 'data' }],
      defaultFormat: 'yaml',
      requiredEnv: [{ name: 'BIOCLI_YAML_TOKEN' }],
      examples: [{ goal: 'Preview YAML snapshot output', command: 'biocli snapshotsite list -f yaml' }],
      noContext: true,
      type: 'yaml',
    };
    writeFileSync(manifestPath, JSON.stringify([entry]));

    await discoverClis(clisDir);
    const cmd = getRegistry().get(REGISTRY_KEY);
    expect(cmd).toBeDefined();
    expect(cmd?.noContext).toBe(true);
    expect(cmd?.defaultFormat).toBe('yaml');
    expect(cmd?.requiredEnv).toEqual([{ name: 'BIOCLI_YAML_TOKEN' }]);
    expect(cmd?.examples).toEqual([{ goal: 'Preview YAML snapshot output', command: 'biocli snapshotsite list -f yaml' }]);
  });
});
