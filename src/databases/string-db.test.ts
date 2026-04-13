import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EXIT_CODES } from '../errors.js';
import { buildStringUrl, stringBackend } from './string-db.js';

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

describe('string backend', () => {
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
      .mockResolvedValueOnce(mockResponse(200, [{ preferredName_A: 'TP53', preferredName_B: 'EGFR' }]));

    const ctx = stringBackend.createContext();
    const promise = ctx.fetchJson(
      buildStringUrl('network', { identifiers: 'TP53%0dEGFR', species: '9606' }),
      { skipRateLimit: true },
    );
    await vi.runAllTimersAsync();
    await expect(promise).resolves.toEqual([{ preferredName_A: 'TP53', preferredName_B: 'EGFR' }]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('repeated 503 responses exhaust retries as a temporary failure', async () => {
    vi.useFakeTimers();
    fetchMock
      .mockResolvedValueOnce(mockResponse(503))
      .mockResolvedValueOnce(mockResponse(503))
      .mockResolvedValueOnce(mockResponse(503));

    const ctx = stringBackend.createContext();
    const promise = ctx.fetchJson(
      buildStringUrl('network', { identifiers: 'TP53%0dEGFR', species: '9606' }),
      { skipRateLimit: true },
    );
    const rejection = expect(promise).rejects.toMatchObject({
      code: 'RATE_LIMITED',
      exitCode: EXIT_CODES.TEMPFAIL,
    });
    await vi.runAllTimersAsync();
    await rejection;
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
