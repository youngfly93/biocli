/**
 * Core smoke tests — verify biocli starts up and built-in commands work.
 * No network calls, no mocks. Uses real CLI subprocess.
 */

import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const TSX_CLI = resolve(ROOT, 'node_modules/tsx/dist/cli.mjs');
const MAIN_SRC = resolve(ROOT, 'src/main.ts');
const MAIN_DIST = resolve(ROOT, 'dist/main.js');

const tempHomes: string[] = [];

function makeIsolatedHome(): string {
  const dir = mkdtempSync(resolve(tmpdir(), 'biocli-smoke-'));
  tempHomes.push(dir);
  return dir;
}

function runInHome(
  entrypoint: string[],
  args: string[],
  opts: { homeDir?: string } = {},
) {
  const homeDir = opts.homeDir ?? makeIsolatedHome();
  return spawnSync(process.execPath, [...entrypoint, ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: 30_000,
    env: { ...process.env, HOME: homeDir, XDG_CONFIG_HOME: homeDir },
  });
}

/** Run CLI from source (tsx). */
function runCli(args: string[]) {
  return runInHome([TSX_CLI, MAIN_SRC], args);
}

/** Run CLI from built dist (node dist/main.js). */
function runDist(args: string[]) {
  return runInHome([MAIN_DIST], args);
}

function runCliWithHome(args: string[], homeDir: string) {
  return runInHome([TSX_CLI, MAIN_SRC], args, { homeDir });
}

function runDistWithHome(args: string[], homeDir: string) {
  return runInHome([MAIN_DIST], args, { homeDir });
}

function runBuild() {
  const npmBin = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  return spawnSync(npmBin, ['run', 'build'], {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: 120_000,
    env: process.env,
  });
}

function readJson(pathname: string) {
  return JSON.parse(readFileSync(pathname, 'utf8'));
}

function writeMethodsFixture(homeDir: string): string {
  const pathname = resolve(homeDir, 'result.json');
  writeFileSync(pathname, JSON.stringify({
    biocliVersion: '0.4.1',
    query: 'TP53',
    organism: 'Homo sapiens',
    queriedAt: '2026-04-10T12:00:00.000Z',
    completeness: 'complete',
    warnings: [],
    sources: ['NCBI Gene', 'UniProt'],
    provenance: {
      retrievedAt: '2026-04-10T12:00:00.000Z',
      sources: [
        {
          source: 'NCBI Gene',
          apiVersion: 'E-utilities',
          recordIds: ['7157'],
          url: 'https://www.ncbi.nlm.nih.gov/gene/7157',
        },
        {
          source: 'UniProt',
          apiVersion: 'REST',
          recordIds: ['P04637'],
          url: 'https://www.uniprot.org/uniprotkb/P04637',
        },
      ],
    },
  }, null, 2), 'utf8');
  return pathname;
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
    expect(schema.properties.provenance).toBeDefined();
    expect(schema.properties.completeness.enum).toContain('partial');
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

  it('validate also checks user CLI directory', () => {
    const homeDir = makeIsolatedHome();
    const userCliDir = resolve(homeDir, '.biocli', 'clis', 'demo');
    mkdirSync(userCliDir, { recursive: true });
    writeFileSync(
      resolve(userCliDir, 'bad.yaml'),
      'description: bad\npipeline:\n  - unknown: 1\n',
      'utf8',
    );

    const result = runCliWithHome(['validate', '-d', 'src/clis'], homeDir);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('bad.yaml');
    expect(result.stderr).toContain('unknown step');
  });

  it('mcp install writes a Claude Desktop config entry from source', () => {
    const homeDir = makeIsolatedHome();
    const configPath = resolve(homeDir, 'claude_desktop_config.json');

    const result = runCliWithHome([
      'mcp',
      'install',
      '--path',
      configPath,
      '--name',
      'biocli-test',
      '--scope',
      'hero',
    ], homeDir);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Installed MCP config');

    const config = readJson(configPath);
    expect(config.mcpServers['biocli-test'].command).toBe(process.execPath);
    expect(config.mcpServers['biocli-test'].args).toEqual([
      TSX_CLI,
      MAIN_SRC,
      'mcp',
      'serve',
      '--scope',
      'hero',
    ]);
  });

  it('methods renders a methods-ready paragraph from source', () => {
    const homeDir = makeIsolatedHome();
    const resultPath = writeMethodsFixture(homeDir);

    const result = runCliWithHome(['methods', resultPath], homeDir);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('biocli v0.4.1 was used');
    expect(result.stdout).toContain('query "TP53"');
    expect(result.stdout).toContain('NCBI Gene');
  });
});

describe('biocli smoke: dist build', () => {
  beforeAll(() => {
    const build = runBuild();
    expect(build.status).toBe(0);
  }, 120_000);

  afterEach(() => {
    while (tempHomes.length > 0) {
      const dir = tempHomes.pop();
      if (dir) rmSync(dir, { recursive: true, force: true });
    }
  });

  it('dist --version matches source', () => {
    const src = runCli(['--version']);
    const dist = runDist(['--version']);
    expect(dist.status).toBe(0);
    expect(dist.stdout.trim()).toBe(src.stdout.trim());
  });

  it('dist list -f json returns same command count as source', () => {
    const src = runCli(['list', '-f', 'json']);
    const dist = runDist(['list', '-f', 'json']);
    expect(dist.status).toBe(0);
    const srcData = JSON.parse(src.stdout);
    const distData = JSON.parse(dist.stdout);
    expect(distData.length).toBe(srcData.length);
  });

  it('dist validate passes without errors', () => {
    const result = runDist(['validate']);
    expect(result.status).toBe(0);
    expect(result.stderr).not.toContain('error');
  });

  it('dist validate also checks user CLI directory', () => {
    const homeDir = makeIsolatedHome();
    const userCliDir = resolve(homeDir, '.biocli', 'clis', 'demo');
    mkdirSync(userCliDir, { recursive: true });
    writeFileSync(
      resolve(userCliDir, 'bad.yaml'),
      'description: bad\npipeline:\n  - unknown: 1\n',
      'utf8',
    );

    const result = runDistWithHome(['validate', '-d', 'src/clis'], homeDir);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('bad.yaml');
    expect(result.stderr).toContain('unknown step');
  });

  it('dist mcp install writes a Claude Desktop config entry', () => {
    const homeDir = makeIsolatedHome();
    const configPath = resolve(homeDir, 'claude_desktop_config.json');

    const result = runDistWithHome([
      'mcp',
      'install',
      '--path',
      configPath,
      '--name',
      'biocli-test',
      '--scope',
      'all',
    ], homeDir);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Installed MCP config');

    const config = readJson(configPath);
    expect(config.mcpServers['biocli-test'].command).toBe(process.execPath);
    expect(config.mcpServers['biocli-test'].args).toEqual([
      MAIN_DIST,
      'mcp',
      'serve',
      '--scope',
      'all',
    ]);
  });

  it('dist methods renders markdown output', () => {
    const homeDir = makeIsolatedHome();
    const resultPath = writeMethodsFixture(homeDir);

    const result = runDistWithHome(['methods', resultPath, '--format', 'md'], homeDir);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('## Methods Summary');
    expect(result.stdout).toContain('## Sources');
    expect(result.stdout).toContain('UniProt');
  });
});
