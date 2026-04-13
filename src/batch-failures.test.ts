import { describe, expect, it } from 'vitest';
import { CliError, EXIT_CODES, TimeoutError } from './errors.js';
import { toBatchFailureRecord } from './batch-failures.js';

describe('toBatchFailureRecord', () => {
  it('maps CliError into a structured failure record', () => {
    const error = new CliError('API_ERROR', 'broken upstream', 'retry later', EXIT_CODES.TEMPFAIL);
    const record = toBatchFailureRecord('aggregate/gene-profile', {
      ok: false,
      item: 'TP53',
      index: 0,
      attempts: 2,
      error,
    });

    expect(record.input).toBe('TP53');
    expect(record.command).toBe('aggregate/gene-profile');
    expect(record.errorCode).toBe('API_ERROR');
    expect(record.retryable).toBe(true);
    expect(record.hint).toBe('retry later');
    expect(record.exitCode).toBe(EXIT_CODES.TEMPFAIL);
  });

  it('falls back to UNKNOWN for non-CliError failures', () => {
    const record = toBatchFailureRecord('aggregate/gene-profile', {
      ok: false,
      item: 'TP53',
      index: 0,
      attempts: 1,
      error: new Error('boom'),
    });

    expect(record.errorCode).toBe('UNKNOWN');
    expect(record.retryable).toBe(false);
    expect(record.message).toBe('boom');
  });
});
