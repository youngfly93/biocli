/**
 * Tests for the PRIDE backend. Minimal: one happy path and one retry test.
 * Both mainly exist to prove the retry helper is wired correctly and PRIDE's
 * backend is registered.
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { ApiError } from '../errors.js';

const { fetchMock } = vi.hoisted(() => ({ fetchMock: vi.fn() }));
vi.mock('../http-dispatcher.js', async (importOriginal) => {
  const actual = await importOriginal() as Record<string, unknown>;
  return { ...actual, fetchWithIPv4Fallback: fetchMock };
});

import { prideBackend, buildPrideUrl } from './pride.js';

function mockResponse(status: number, body: unknown = {}): Response {
  return {
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    ok: status >= 200 && status < 300,
    json: async () => body,
    text: async () => JSON.stringify(body),
    headers: new Headers(),
  } as unknown as Response;
}

describe('pride backend', () => {
  beforeEach(() => {
    fetchMock.mockReset();
  });

  it('registers as the "pride" backend with correct metadata', () => {
    expect(prideBackend.id).toBe('pride');
    expect(prideBackend.name).toBe('PRIDE');
    expect(prideBackend.baseUrl).toContain('ebi.ac.uk/pride/ws/archive/v3');
    expect(prideBackend.rateLimit).toBe(5);
  });

  it('happy-path fetchJson returns parsed body', async () => {
    fetchMock.mockResolvedValueOnce(
      mockResponse(200, { accession: 'PXD000001', title: 'TMT spikes' }),
    );
    const ctx = prideBackend.createContext();
    const result = await ctx.fetchJson(
      buildPrideUrl('/projects/PXD000001'),
      { skipRateLimit: true },
    );
    expect(result).toEqual({ accession: 'PXD000001', title: 'TMT spikes' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('non-OK 404 throws ApiError without retry', async () => {
    fetchMock.mockResolvedValueOnce(mockResponse(404));
    const ctx = prideBackend.createContext();
    await expect(
      ctx.fetchJson(buildPrideUrl('/projects/PXD9999999'), { skipRateLimit: true }),
    ).rejects.toMatchObject({
      hint: expect.stringContaining('biocli px search <query> -f json'),
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('pride 5xx retry', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('503 then 200 succeeds after one retry', async () => {
    fetchMock
      .mockResolvedValueOnce(mockResponse(503))
      .mockResolvedValueOnce(mockResponse(200, { back: true }));

    const ctx = prideBackend.createContext();
    const promise = ctx.fetchJson(
      buildPrideUrl('/projects/PXD000001'),
      { skipRateLimit: true },
    );
    await vi.runAllTimersAsync();
    const result = await promise;
    expect(result).toEqual({ back: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe('buildPrideUrl', () => {
  it('builds REST-style path without params', () => {
    const url = buildPrideUrl('/projects/PXD000001');
    expect(url).toBe('https://www.ebi.ac.uk/pride/ws/archive/v3/projects/PXD000001');
  });

  it('appends query params, skipping undefined', () => {
    const url = buildPrideUrl('/search/projects', {
      keyword: 'phospho',
      pageSize: '5',
      filter: undefined,
    });
    expect(url).toContain('keyword=phospho');
    expect(url).toContain('pageSize=5');
    expect(url).not.toContain('filter');
  });
});
