import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EXIT_CODES } from '../errors.js';

const fetchMock = vi.fn();

import { buildUniprotUrl, uniprotBackend } from './uniprot.js';

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

describe('uniprot backend', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('entry lookup failures suggest using uniprot search first', async () => {
    fetchMock.mockResolvedValueOnce(mockResponse(404));
    const ctx = uniprotBackend.createContext();

    await expect(
      ctx.fetchJson(buildUniprotUrl('/uniprotkb/P99999', { format: 'json' }), { skipRateLimit: true }),
    ).rejects.toMatchObject({
      hint: expect.stringContaining('biocli uniprot search <query> -f json'),
    });
  });

  it('search failures still point to the search command instead of a raw URL', async () => {
    fetchMock.mockResolvedValueOnce(mockResponse(400));
    const ctx = uniprotBackend.createContext();

    await expect(
      ctx.fetchJson(buildUniprotUrl('/uniprotkb/search', { query: 'TP53', format: 'json' }), { skipRateLimit: true }),
    ).rejects.toMatchObject({
      hint: expect.stringContaining('biocli uniprot search <query> -f json'),
    });
  });

  it('repeated 429 responses exhaust retries as a temporary failure', async () => {
    vi.useFakeTimers();
    fetchMock
      .mockResolvedValueOnce(mockResponse(429))
      .mockResolvedValueOnce(mockResponse(429))
      .mockResolvedValueOnce(mockResponse(429));

    const ctx = uniprotBackend.createContext();
    const promise = ctx.fetchJson(
      buildUniprotUrl('/uniprotkb/search', { query: 'TP53', format: 'json' }),
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
