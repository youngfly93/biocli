import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../errors.js';

const { fetchMock } = vi.hoisted(() => ({ fetchMock: vi.fn() }));
vi.mock('../http-dispatcher.js', async (importOriginal) => {
  const actual = await importOriginal() as Record<string, unknown>;
  return { ...actual, fetchWithIPv4Fallback: fetchMock };
});

import { gdscBackend } from './gdsc.js';

function mockResponse(status: number, body = 'error'): Response {
  return {
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    ok: status >= 200 && status < 300,
    arrayBuffer: async () => new TextEncoder().encode(body).buffer,
    json: async () => ({ body }),
    text: async () => body,
    headers: new Headers(),
  } as unknown as Response;
}

describe('gdsc backend', () => {
  beforeEach(() => {
    fetchMock.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('non-OK responses explain how to refresh the local GDSC cache', async () => {
    fetchMock.mockResolvedValueOnce(mockResponse(404));
    const ctx = gdscBackend.createContext();

    await expect(
      ctx.fetch('https://cog.sanger.ac.uk/cancerrxgene/GDSC_release8.5/missing.tsv', { skipRateLimit: true }),
    ).rejects.toMatchObject({
      hint: expect.stringContaining('biocli gdsc refresh'),
    });
  });
});
