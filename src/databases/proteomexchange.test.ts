/**
 * Tests for the proteomexchange backend — focused on the 5xx retry logic,
 * which is the load-bearing piece that makes ProteomeCentral's transient
 * 500s survivable.
 *
 * Uses vi.mock + fake timers so retry delays don't slow the test suite.
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { ApiError } from '../errors.js';

// Mock the network layer BEFORE importing the module under test so that
// the backend's `proxiFetch` calls our fake instead of the real network.
const { fetchMock } = vi.hoisted(() => ({ fetchMock: vi.fn() }));
vi.mock('../http-dispatcher.js', async (importOriginal) => {
  const actual = await importOriginal() as Record<string, unknown>;
  return { ...actual, fetchWithIPv4Fallback: fetchMock };
});

import { proteomexchangeBackend, buildProxiUrl } from './proteomexchange.js';

/** Build a minimal Response-like object with the given status + JSON body. */
function mockResponse(status: number, body: unknown = {}): Response {
  return {
    status,
    statusText: status === 200 ? 'OK' : status === 500 ? 'Internal Server Error' : 'Error',
    ok: status >= 200 && status < 300,
    json: async () => body,
    text: async () => JSON.stringify(body),
    headers: new Headers(),
  } as unknown as Response;
}

describe('proteomexchange 5xx retry (F5-scale regression surface)', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    // Fake timers let us assert on the delay progression without actually waiting.
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('500, 500, 200 succeeds after 2 retries with 1s + 2s backoff', async () => {
    fetchMock
      .mockResolvedValueOnce(mockResponse(500))
      .mockResolvedValueOnce(mockResponse(500))
      .mockResolvedValueOnce(mockResponse(200, { ok: true }));

    const ctx = proteomexchangeBackend.createContext();
    const promise = ctx.fetchJson(buildProxiUrl('/datasets', { pageSize: '1' }), { skipRateLimit: true });

    // Advance through both retry delays — sleep(1000), sleep(2000).
    // runAllTimersAsync is safer than manual advanceTimersByTime here because
    // the code awaits `sleep()` which schedules a single setTimeout; runAll
    // flushes all pending timers in order.
    await vi.runAllTimersAsync();

    const result = await promise;
    expect(result).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('500, 500, 500 exhausts retries and throws ApiError mentioning 500', async () => {
    fetchMock
      .mockResolvedValueOnce(mockResponse(500))
      .mockResolvedValueOnce(mockResponse(500))
      .mockResolvedValueOnce(mockResponse(500));

    const ctx = proteomexchangeBackend.createContext();
    const promise = ctx.fetchJson(buildProxiUrl('/datasets'), { skipRateLimit: true });
    // We expect a rejection — attach the assertion first, then advance timers.
    const assertion = expect(promise).rejects.toThrowError(/HTTP 500 after 3 attempts/);
    await vi.runAllTimersAsync();
    await assertion;
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('502, 503, 504 are all retryable', async () => {
    fetchMock
      .mockResolvedValueOnce(mockResponse(502))
      .mockResolvedValueOnce(mockResponse(503))
      .mockResolvedValueOnce(mockResponse(200, { hit: true }));

    const ctx = proteomexchangeBackend.createContext();
    const promise = ctx.fetchJson(buildProxiUrl('/datasets'), { skipRateLimit: true });
    await vi.runAllTimersAsync();
    const result = await promise;
    expect(result).toEqual({ hit: true });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('400 is NOT retried (client errors are permanent)', async () => {
    fetchMock.mockResolvedValueOnce(mockResponse(400));

    const ctx = proteomexchangeBackend.createContext();
    await expect(ctx.fetchJson(buildProxiUrl('/datasets'), { skipRateLimit: true })).rejects.toBeInstanceOf(ApiError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('501 Not Implemented is NOT retried (permanent 5xx)', async () => {
    fetchMock.mockResolvedValueOnce(mockResponse(501));

    const ctx = proteomexchangeBackend.createContext();
    await expect(ctx.fetchJson(buildProxiUrl('/datasets'), { skipRateLimit: true })).rejects.toBeInstanceOf(ApiError);
    // Critical: 501 is not in the retry set, so exactly ONE call.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('network-level error triggers retry', async () => {
    fetchMock
      .mockRejectedValueOnce(new Error('ECONNRESET'))
      .mockRejectedValueOnce(new Error('ETIMEDOUT'))
      .mockResolvedValueOnce(mockResponse(200, { recovered: true }));

    const ctx = proteomexchangeBackend.createContext();
    const promise = ctx.fetchJson(buildProxiUrl('/datasets'), { skipRateLimit: true });
    await vi.runAllTimersAsync();
    const result = await promise;
    expect(result).toEqual({ recovered: true });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('successful response on first attempt does not retry', async () => {
    fetchMock.mockResolvedValueOnce(mockResponse(200, { easy: true }));

    const ctx = proteomexchangeBackend.createContext();
    const result = await ctx.fetchJson(buildProxiUrl('/datasets'), { skipRateLimit: true });
    expect(result).toEqual({ easy: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('buildProxiUrl', () => {
  it('builds base URL without params', () => {
    const url = buildProxiUrl('/datasets');
    expect(url).toBe('https://proteomecentral.proteomexchange.org/api/proxi/v0.1/datasets');
  });

  it('appends query params, skipping undefined and empty strings', () => {
    const url = buildProxiUrl('/datasets', {
      keywords: 'phospho',
      pageSize: '5',
      species: undefined,
      instrument: '',
    });
    expect(url).toContain('keywords=phospho');
    expect(url).toContain('pageSize=5');
    expect(url).not.toContain('species');
    expect(url).not.toContain('instrument');
  });

  it('supports REST-style paths for single-record fetches', () => {
    const url = buildProxiUrl('/datasets/PXD000001');
    expect(url).toBe('https://proteomecentral.proteomexchange.org/api/proxi/v0.1/datasets/PXD000001');
  });

  it('URL-encodes multi-word query values', () => {
    const url = buildProxiUrl('/datasets', { search: 'TP53 breast cancer' });
    // URLSearchParams encodes space as '+' — acceptable
    expect(url).toMatch(/search=TP53(\+|%20)breast(\+|%20)cancer/);
  });
});
