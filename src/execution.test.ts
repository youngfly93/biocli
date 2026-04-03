/**
 * Unit tests for argument coercion and validation.
 */

import { describe, expect, it } from 'vitest';
import { coerceAndValidateArgs } from './execution.js';
import { ArgumentError } from './errors.js';
import type { Arg } from './registry.js';

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
