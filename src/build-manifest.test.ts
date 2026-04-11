import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadTsManifestEntries } from './build-manifest.js';
import { getRegistry, registerCommand, type InternalCliCommand, Strategy } from './registry.js';

describe('build-manifest TS attribution', () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const key of [...getRegistry().keys()]) {
      if (key.startsWith('manifest-test/')) getRegistry().delete(key);
    }
    while (tempDirs.length > 0) {
      const dir = tempDirs.pop();
      if (dir) rmSync(dir, { recursive: true, force: true });
    }
  });

  it('keeps imported side-effect commands from stealing modulePath ownership', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'biocli-build-manifest-'));
    tempDirs.push(dir);
    const mainFile = join(dir, 'drug-target.ts');
    const importedFile = join(dir, 'tumor-gene-dossier.ts');
    writeFileSync(mainFile, 'cli({});\n', 'utf8');

    const entries = await loadTsManifestEntries(mainFile, 'manifest-test', async () => {
      registerCommand({
        site: 'manifest-test',
        name: 'drug-target',
        description: 'main command',
        strategy: Strategy.PUBLIC,
        args: [],
        defaultFormat: 'json',
        source: 'test',
        _sourceFile: mainFile,
      } as InternalCliCommand);
      registerCommand({
        site: 'manifest-test',
        name: 'tumor-gene-dossier',
        description: 'imported side-effect command',
        strategy: Strategy.PUBLIC,
        args: [],
        source: 'test',
        _sourceFile: importedFile,
      } as InternalCliCommand);
      return {};
    });

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      site: 'manifest-test',
      name: 'drug-target',
      modulePath: 'manifest-test/drug-target.js',
      defaultFormat: 'json',
    });
  });

  it('finds file-owned commands even when the module was already cached earlier', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'biocli-build-manifest-'));
    tempDirs.push(dir);
    const filePath = join(dir, 'gene-dossier.ts');
    writeFileSync(filePath, 'cli({});\n', 'utf8');

    registerCommand({
      site: 'manifest-test',
      name: 'gene-dossier',
      description: 'cached command',
      strategy: Strategy.PUBLIC,
      args: [],
      source: 'test',
      _sourceFile: filePath,
    } as InternalCliCommand);

    const entries = await loadTsManifestEntries(filePath, 'manifest-test', async () => ({}));

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      site: 'manifest-test',
      name: 'gene-dossier',
      modulePath: 'manifest-test/gene-dossier.js',
    });
  });

  it('serializes manifest-facing command metadata needed by discovery', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'biocli-build-manifest-'));
    tempDirs.push(dir);
    const filePath = join(dir, 'workflow-prepare.ts');
    writeFileSync(filePath, 'cli({});\n', 'utf8');

    const entries = await loadTsManifestEntries(filePath, 'manifest-test', async () => {
      registerCommand({
        site: 'manifest-test',
        name: 'workflow-prepare',
        description: 'prepare test workspace',
        database: 'aggregate',
        strategy: Strategy.PUBLIC,
        args: [],
        columns: ['step', 'status'],
        timeoutSeconds: 300,
        requiredEnv: [{ name: 'BIOCLI_API_TOKEN', help: 'Set the token first.' }],
        examples: [{ goal: 'Prepare a workflow workspace', command: 'biocli manifest-test workflow-prepare -f json' }],
        readOnly: false,
        sideEffects: ['writes-filesystem', 'downloads-remote-files'],
        artifacts: [{ path: '<outdir>/manifest.json', kind: 'file', description: 'Workflow provenance manifest' }],
        deprecated: 'old workflow',
        replacedBy: 'manifest-test/workflow-next',
        defaultFormat: 'json',
        noContext: true,
        noBatch: true,
        source: 'test',
        _sourceFile: filePath,
      } as InternalCliCommand);
      return {};
    });

    expect(entries).toEqual([
      {
        site: 'manifest-test',
        name: 'workflow-prepare',
        aliases: undefined,
        description: 'prepare test workspace',
        database: 'aggregate',
        strategy: 'public',
        args: [],
        columns: ['step', 'status'],
        defaultFormat: 'json',
        timeout: 300,
        requiredEnv: [{ name: 'BIOCLI_API_TOKEN', help: 'Set the token first.' }],
        examples: [{ goal: 'Prepare a workflow workspace', command: 'biocli manifest-test workflow-prepare -f json' }],
        readOnly: false,
        sideEffects: ['writes-filesystem', 'downloads-remote-files'],
        artifacts: [{ path: '<outdir>/manifest.json', kind: 'file', description: 'Workflow provenance manifest' }],
        deprecated: 'old workflow',
        replacedBy: 'manifest-test/workflow-next',
        noContext: true,
        noBatch: true,
        type: 'ts',
        modulePath: 'manifest-test/workflow-prepare.js',
      },
    ]);
  });
});
