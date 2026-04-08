/**
 * Unit tests for argument coercion and validation + database=unimod exemption.
 */

import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir, homedir } from 'node:os';
import { coerceAndValidateArgs, executeCommand } from './execution.js';
import { ArgumentError } from './errors.js';
import type { Arg, CliCommand } from './registry.js';
import type { HttpContext } from './types.js';

describe('coerceAndValidateArgs', () => {
  it('throws when required arg is missing', () => {
    const args: Arg[] = [{ name: 'query', positional: true, required: true, help: 'Search query' }];
    expect(() => coerceAndValidateArgs(args, {})).toThrow(ArgumentError);
  });

  it('throws when required arg is empty string', () => {
    const args: Arg[] = [{ name: 'query', positional: true, required: true, help: 'Search query' }];
    expect(() => coerceAndValidateArgs(args, { query: '' })).toThrow(ArgumentError);
  });

  it('coerces int type', () => {
    const args: Arg[] = [{ name: 'limit', type: 'int', default: 10 }];
    const result = coerceAndValidateArgs(args, { limit: '25' });
    expect(result.limit).toBe(25);
  });

  it('throws on invalid int value', () => {
    const args: Arg[] = [{ name: 'limit', type: 'int' }];
    expect(() => coerceAndValidateArgs(args, { limit: 'abc' })).toThrow(ArgumentError);
  });

  it('coerces boolean type', () => {
    const args: Arg[] = [{ name: 'verbose', type: 'boolean' }];
    expect(coerceAndValidateArgs(args, { verbose: 'true' }).verbose).toBe(true);
    expect(coerceAndValidateArgs(args, { verbose: 'false' }).verbose).toBe(false);
    expect(coerceAndValidateArgs(args, { verbose: '1' }).verbose).toBe(true);
    expect(coerceAndValidateArgs(args, { verbose: '0' }).verbose).toBe(false);
  });

  it('throws on invalid boolean value', () => {
    const args: Arg[] = [{ name: 'verbose', type: 'boolean' }];
    expect(() => coerceAndValidateArgs(args, { verbose: 'maybe' })).toThrow(ArgumentError);
  });

  it('validates choices', () => {
    const args: Arg[] = [{ name: 'format', choices: ['json', 'csv', 'table'] }];
    expect(coerceAndValidateArgs(args, { format: 'json' }).format).toBe('json');
    expect(() => coerceAndValidateArgs(args, { format: 'xml' })).toThrow(ArgumentError);
  });

  it('applies default when value is missing', () => {
    const args: Arg[] = [{ name: 'limit', type: 'int', default: 10 }];
    const result = coerceAndValidateArgs(args, {});
    expect(result.limit).toBe(10);
  });

  it('passes through optional arg without default', () => {
    const args: Arg[] = [{ name: 'sort' }];
    const result = coerceAndValidateArgs(args, {});
    expect(result.sort).toBeUndefined();
  });
});

describe('executeCommand — unimod snapshot exemption', () => {
  // Back up HOME so the response cache doesn't scribble on the user's real dir.
  const savedHome = process.env.HOME;
  let tempHome: string;

  beforeEach(() => {
    tempHome = mkdtempSync(join(tmpdir(), 'biocli-exec-test-'));
    process.env.HOME = tempHome;
  });

  afterEach(() => {
    if (savedHome === undefined) delete process.env.HOME;
    else process.env.HOME = savedHome;
    try { rmSync(tempHome, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  function makeTestCommand(database: string, capture: { ctx?: HttpContext }): CliCommand {
    return {
      site: 'test',
      name: 'noop',
      description: '',
      database,
      args: [],
      func: async (ctx, _args) => {
        capture.ctx = ctx;
        return [{ hello: 'world' }];
      },
    };
  }

  it('provides a throw-on-use ctx for database=unimod instead of NCBI fallback', async () => {
    const capture: { ctx?: HttpContext } = {};
    const cmd = makeTestCommand('unimod', capture);
    await executeCommand(cmd, {});
    expect(capture.ctx).toBeDefined();
    expect(capture.ctx!.databaseId).toBe('unimod');
    // All fetch methods must throw — proves it is NOT the NCBI context.
    await expect(capture.ctx!.fetch('https://example.com')).rejects.toThrow();
    await expect(capture.ctx!.fetchJson('https://example.com')).rejects.toThrow();
    await expect(capture.ctx!.fetchXml('https://example.com')).rejects.toThrow();
    await expect(capture.ctx!.fetchText('https://example.com')).rejects.toThrow();
  });

  it('does NOT write to the response cache under ~/.biocli/cache/unimod/', async () => {
    const capture: { ctx?: HttpContext } = {};
    const cmd = makeTestCommand('unimod', capture);
    await executeCommand(cmd, {});
    const cacheDir = join(tempHome, '.biocli', 'cache', 'unimod');
    if (existsSync(cacheDir)) {
      // If it exists it must be empty (i.e. no files were written).
      const contents = readdirSync(cacheDir);
      expect(contents).toEqual([]);
    }
  });

  it('still produces a correct result for database=unimod commands', async () => {
    const capture: { ctx?: HttpContext } = {};
    const cmd = makeTestCommand('unimod', capture);
    const result = await executeCommand(cmd, {});
    expect(result).toEqual([{ hello: 'world' }]);
  });
});
