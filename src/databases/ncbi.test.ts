import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../errors.js';

const { fetchMock } = vi.hoisted(() => ({ fetchMock: vi.fn() }));
vi.mock('../http-dispatcher.js', async (importOriginal) => {
  const actual = await importOriginal() as Record<string, unknown>;
  return { ...actual, fetchWithIPv4Fallback: fetchMock };
});

import { buildEutilsUrl, ncbiFetch } from './ncbi.js';

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

describe('ncbi backend', () => {
  beforeEach(() => {
    fetchMock.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('PubMed failures point agents to pubmed search instead of raw E-utilities URLs', async () => {
    fetchMock.mockResolvedValueOnce(mockResponse(404));

    await expect(
      ncbiFetch(buildEutilsUrl('efetch.fcgi', {
        db: 'pubmed',
        id: '123',
        retmode: 'xml',
      }), { skipRateLimit: true }),
    ).rejects.toMatchObject({
      hint: expect.stringContaining('biocli pubmed search <query> -f json'),
    });
  });

  it('Gene failures point agents to gene search for a valid Gene ID', async () => {
    fetchMock.mockResolvedValueOnce(mockResponse(404));

    await expect(
      ncbiFetch(buildEutilsUrl('esummary.fcgi', {
        db: 'gene',
        id: '999999999',
        retmode: 'json',
      }), { skipRateLimit: true }),
    ).rejects.toMatchObject({
      hint: expect.stringContaining('biocli gene search <symbol> -f json'),
    });
  });
});
