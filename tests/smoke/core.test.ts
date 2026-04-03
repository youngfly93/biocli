/**
 * Core smoke tests — verify biocli starts up and built-in commands work.
 * No network calls, no mocks. Uses real CLI subprocess.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const TSX_CLI = resolve(ROOT, 'node_modules/tsx/dist/cli.mjs');
const MAIN = resolve(ROOT, 'src/main.ts');

const tempHomes: string[] = [];

function makeIsolatedHome(): string {
  const dir = mkdtempSync(resolve(tmpdir(), 'biocli-smoke-'));
  tempHomes.push(dir);
  return dir;
}

function runCli(args: string[]) {
  const homeDir = makeIsolatedHome();
  return spawnSync(process.execPath, [TSX_CLI, MAIN, ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: 30_000,
    env: { ...process.env, HOME: homeDir, XDG_CONFIG_HOME: homeDir },
  });
}

describe('biocli smoke: core', () => {
  afterEach(() => {
    while (tempHomes.length > 0) {
      const dir = tempHomes.pop();
      if (dir) rmSync(dir, { recursive: true, force: true });
    }
  });

  it('--version returns a version string', () => {
    const result = runCli(['--version']);
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('list -f json returns non-empty array', () => {
    const result = runCli(['list', '-f', 'json']);
    expect(result.status).toBe(0);
    const data = JSON.parse(result.stdout);
    expect(Array.isArray(data)).toBe(true);
    expect(data.length).toBeGreaterThan(30);
  });

  it('config path returns a path string', () => {
    const result = runCli(['config', 'path']);
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toContain('.biocli');
  });

  it('schema returns valid JSON Schema', () => {
    const result = runCli(['schema']);
    expect(result.status).toBe(0);
    const schema = JSON.parse(result.stdout);
    expect(schema.title).toBe('BiocliResult');
    expect(schema.$schema).toContain('json-schema.org');
  });

  it('schema meta returns ResultWithMeta schema', () => {
    const result = runCli(['schema', 'meta']);
    expect(result.status).toBe(0);
    const schema = JSON.parse(result.stdout);
    expect(schema.title).toBe('ResultWithMeta');
  });

  it('completion bash returns shell script', () => {
    const result = runCli(['completion', 'bash']);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('_biocli_completions');
  });

  it('list -f json includes enhanced metadata', () => {
    const result = runCli(['list', '-f', 'json']);
    const data = JSON.parse(result.stdout);
    const cmd = data.find((c: any) => c.command === 'gene/search');
    expect(cmd.tags).toContain('query');
    expect(cmd.args).toBeDefined();
    expect(cmd.args.length).toBeGreaterThan(0);
    expect(cmd.defaultFormat).toBeDefined();
    expect(cmd.columns).toBeDefined();
  });
});
