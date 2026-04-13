import { describe, expect, it } from 'vitest';
import { computeRetryDelayMs, isRetryableNetworkError, resolveHttpRetryPolicy } from './retry-policy.js';

describe('retry-policy', () => {
  it('resolves backend defaults with exponential backoff', () => {
    const policy = resolveHttpRetryPolicy('enrichr');
    expect(policy.maxRetries).toBe(2);
    expect(policy.baseDelayMs).toBe(500);
    expect(computeRetryDelayMs(policy, 0)).toBe(500);
    expect(computeRetryDelayMs(policy, 1)).toBe(1000);
  });

  it('treats known network failures as retryable', () => {
    const policy = resolveHttpRetryPolicy('cbioportal');
    expect(isRetryableNetworkError(policy, { cause: { code: 'ECONNRESET' } })).toBe(true);
    expect(isRetryableNetworkError(policy, new TypeError('fetch failed'))).toBe(true);
    expect(isRetryableNetworkError(policy, new Error('permanent schema mismatch'))).toBe(false);
  });
});
