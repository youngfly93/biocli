import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EXIT_CODES } from '../errors.js';
import { enrichrBackend } from './enrichr.js';

const fetchMock = vi.fn();

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

describe('enrichr backend', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('503 then 200 succeeds after retry with shared backoff policy', async () => {
    vi.useFakeTimers();
    fetchMock
      .mockResolvedValueOnce(mockResponse(503))
      .mockResolvedValueOnce(mockResponse(200, { ok: true }));

    const ctx = enrichrBackend.createContext();
    const promise = ctx.fetchJson(
      'https://maayanlab.cloud/Enrichr/enrich?userListId=1&backgroundType=GO_Biological_Process_2023',
      { skipRateLimit: true },
    );
    await vi.runAllTimersAsync();
    await expect(promise).resolves.toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('repeated 503 responses exhaust retries as a temporary failure', async () => {
    vi.useFakeTimers();
    fetchMock
      .mockResolvedValueOnce(mockResponse(503))
      .mockResolvedValueOnce(mockResponse(503))
      .mockResolvedValueOnce(mockResponse(503));

    const ctx = enrichrBackend.createContext();
    const promise = ctx.fetchJson(
      'https://maayanlab.cloud/Enrichr/enrich?userListId=1&backgroundType=GO_Biological_Process_2023',
      { skipRateLimit: true },
    );
    const rejection = expect(promise).rejects.toMatchObject({
      code: 'API_ERROR',
      exitCode: EXIT_CODES.TEMPFAIL,
    });
    await vi.runAllTimersAsync();
    await rejection;
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
