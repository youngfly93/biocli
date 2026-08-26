import { describe, expect, it } from 'vitest';
import { computeRetryDelayMs, executeHttpRequestWithRetry, isRetryableNetworkError, resolveHttpRetryPolicy } from './retry-policy.js';
import { getRateLimiterForDatabase } from './rate-limiter.js';
import { ApiError } from './errors.js';

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

  it('feeds an upstream 429 back into the backend rate limiter', async () => {
    // Backends acquire a slot before the retry loop runs, so a 429 that only
    // slowed its own request left every other worker saturating the window.
    const backendId = 'test-429-feedback';
    const limiter = getRateLimiterForDatabase(backendId, 100);
    expect(limiter.cooldownRemainingMs).toBe(0);

    let calls = 0;
    const response = await executeHttpRequestWithRetry({
      backendId,
      policy: { maxRetries: 1, baseDelayMs: 60, backoffFactor: 1, retryableStatusCodes: [429] },
      execute: async () => {
        calls += 1;
        return calls === 1
          ? new Response('rate limited', { status: 429 })
          : new Response('{}', { status: 200 });
      },
      onRetryableStatusExhausted: (status, attempts) => new ApiError(`${status} after ${attempts}`),
      onNonRetryableStatus: res => new ApiError(`HTTP ${res.status}`),
      onNetworkErrorExhausted: err => new ApiError(err.message),
    });

    expect(calls).toBe(2);
    expect(response.status).toBe(200);
  });

  it('does not penalize the limiter for non-rate-limit retryable statuses', async () => {
    const backendId = 'test-503-no-penalty';
    const limiter = getRateLimiterForDatabase(backendId, 100);

    let calls = 0;
    await executeHttpRequestWithRetry({
      backendId,
      policy: { maxRetries: 1, baseDelayMs: 5, backoffFactor: 1, retryableStatusCodes: [503] },
      execute: async () => {
        calls += 1;
        return calls === 1
          ? new Response('unavailable', { status: 503 })
          : new Response('{}', { status: 200 });
      },
      onRetryableStatusExhausted: (status, attempts) => new ApiError(`${status} after ${attempts}`),
      onNonRetryableStatus: res => new ApiError(`HTTP ${res.status}`),
      onNetworkErrorExhausted: err => new ApiError(err.message),
    });

    expect(calls).toBe(2);
    expect(limiter.cooldownRemainingMs).toBe(0);
  });


  it('makes a 429 retry consume its own rate-limit slot', async () => {
    // The backend acquires the first slot before entering the retry loop. A
    // retry is another request against the same budget, so firing it straight
    // through put two requests inside a one-request window.
    const backendId = 'test-retry-consumes-slot';
    const limiter = getRateLimiterForDatabase(backendId, 1);
    await limiter.acquire();

    const started = Date.now();
    let calls = 0;
    await executeHttpRequestWithRetry({
      backendId,
      rateLimited: true,
      policy: { maxRetries: 1, baseDelayMs: 50, backoffFactor: 1, retryableStatusCodes: [429] },
      execute: async () => {
        calls += 1;
        return calls === 1
          ? new Response('rate limited', { status: 429 })
          : new Response('{}', { status: 200 });
      },
      onRetryableStatusExhausted: (status, attempts) => new ApiError(`${status} after ${attempts}`),
      onNonRetryableStatus: res => new ApiError(`HTTP ${res.status}`),
      onNetworkErrorExhausted: err => new ApiError(err.message),
    });

    // At 1 req/s the retry cannot go out until the window frees up, so the
    // whole exchange must take about a second rather than just the backoff.
    expect(calls).toBe(2);
    expect(Date.now() - started).toBeGreaterThanOrEqual(900);
  });

  it('leaves retries unmetered when the caller skipped rate limiting', async () => {
    const backendId = 'test-retry-skip-rate-limit';
    const limiter = getRateLimiterForDatabase(backendId, 1);
    await limiter.acquire();

    const started = Date.now();
    let calls = 0;
    await executeHttpRequestWithRetry({
      backendId,
      rateLimited: false,
      policy: { maxRetries: 1, baseDelayMs: 20, backoffFactor: 1, retryableStatusCodes: [503] },
      execute: async () => {
        calls += 1;
        return calls === 1
          ? new Response('unavailable', { status: 503 })
          : new Response('{}', { status: 200 });
      },
      onRetryableStatusExhausted: (status, attempts) => new ApiError(`${status} after ${attempts}`),
      onNonRetryableStatus: res => new ApiError(`HTTP ${res.status}`),
      onNetworkErrorExhausted: err => new ApiError(err.message),
    });

    expect(calls).toBe(2);
    expect(Date.now() - started).toBeLessThan(500);
  });

});
