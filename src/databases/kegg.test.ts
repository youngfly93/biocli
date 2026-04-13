import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EXIT_CODES } from '../errors.js';
import { buildKeggUrl, keggBackend } from './kegg.js';

const fetchMock = vi.fn();

function mockResponse(status: number, body: string = ''): Response {
  return {
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    ok: status >= 200 && status < 300,
    json: async () => ({ raw: body }),
    text: async () => body,
    headers: new Headers(),
  } as unknown as Response;
}

describe('kegg backend', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('404 remains a non-retryable not-found error', async () => {
    fetchMock.mockResolvedValueOnce(mockResponse(404));
    const ctx = keggBackend.createContext();

    await expect(
      ctx.fetchText(buildKeggUrl('/get/hsa:999999'), { skipRateLimit: true }),
    ).rejects.toMatchObject({
      code: 'API_ERROR',
      exitCode: 1,
      message: 'KEGG entry not found',
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('repeated 429 responses exhaust retries as a temporary failure', async () => {
    vi.useFakeTimers();
    fetchMock
      .mockResolvedValueOnce(mockResponse(429))
      .mockResolvedValueOnce(mockResponse(429))
      .mockResolvedValueOnce(mockResponse(429));

    const ctx = keggBackend.createContext();
    const promise = ctx.fetchText(buildKeggUrl('/list/pathway/hsa'), { skipRateLimit: true });
    const rejection = expect(promise).rejects.toMatchObject({
      code: 'RATE_LIMITED',
      exitCode: EXIT_CODES.TEMPFAIL,
    });
    await vi.runAllTimersAsync();
    await rejection;
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
