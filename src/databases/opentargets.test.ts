import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../errors.js';

const { fetchMock } = vi.hoisted(() => ({ fetchMock: vi.fn() }));
vi.mock('../http-dispatcher.js', async (importOriginal) => {
  const actual = await importOriginal() as Record<string, unknown>;
  return { ...actual, fetchWithIPv4Fallback: fetchMock };
});

import {
  OPENTARGETS_BASE_URL,
  fetchDrugsByIds,
  fetchTargetDrugSnapshot,
  opentargetsBackend,
  resolveTarget,
} from './opentargets.js';

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

describe('opentargets backend', () => {
  beforeEach(() => {
    fetchMock.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('registers as the "opentargets" backend with correct metadata', () => {
    expect(opentargetsBackend.id).toBe('opentargets');
    expect(opentargetsBackend.name).toBe('Open Targets');
    expect(opentargetsBackend.baseUrl).toBe(OPENTARGETS_BASE_URL);
    expect(opentargetsBackend.rateLimit).toBe(4);
  });

  it('resolveTarget prefers an exact symbol match from search hits', async () => {
    fetchMock.mockResolvedValueOnce(mockResponse(200, {
      data: {
        search: {
          hits: [
            {
              id: 'ENSG00000275493',
              entity: 'target',
              object: { approvedSymbol: 'TP53BP1', approvedName: 'TP53 binding protein 1' },
            },
            {
              id: 'ENSG00000141510',
              entity: 'target',
              object: { approvedSymbol: 'TP53', approvedName: 'tumor protein p53', biotype: 'protein_coding' },
            },
          ],
        },
      },
    }));

    const ctx = opentargetsBackend.createContext();
    const target = await resolveTarget(ctx, 'TP53');

    expect(target).toEqual({
      id: 'ENSG00000141510',
      approvedSymbol: 'TP53',
      approvedName: 'tumor protein p53',
      biotype: 'protein_coding',
    });
  });

  it('fetchTargetDrugSnapshot returns parsed target data', async () => {
    fetchMock.mockResolvedValueOnce(mockResponse(200, {
      data: {
        target: {
          id: 'ENSG00000146648',
          approvedSymbol: 'EGFR',
          approvedName: 'epidermal growth factor receptor',
          biotype: 'protein_coding',
          tractability: [{ label: 'Approved Drug', modality: 'SM', value: true }],
          associatedDiseases: { count: 1, rows: [] },
          drugAndClinicalCandidates: { count: 1, rows: [] },
        },
      },
    }));

    const ctx = opentargetsBackend.createContext();
    const result = await fetchTargetDrugSnapshot(ctx, 'ENSG00000146648', 0, 5);

    expect(result?.approvedSymbol).toBe('EGFR');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(OPENTARGETS_BASE_URL);
    const payload = JSON.parse(String(options.body)) as Record<string, unknown>;
    expect(String(payload.query)).toContain('query TargetDrugSnapshot');
    expect(payload.variables).toEqual({
      ensemblId: 'ENSG00000146648',
      diseasePageIndex: 0,
      diseasePageSize: 5,
    });
  });

  it('fetchDrugsByIds throws ApiError on GraphQL errors', async () => {
    fetchMock.mockResolvedValueOnce(mockResponse(200, {
      errors: [{ message: 'Cannot query field "badField" on type "Drug".' }],
    }));

    const ctx = opentargetsBackend.createContext();
    await expect(fetchDrugsByIds(ctx, ['CHEMBL1'])).rejects.toBeInstanceOf(ApiError);
  });

  it('503 then 200 succeeds after one retry', async () => {
    vi.useFakeTimers();
    fetchMock
      .mockResolvedValueOnce(mockResponse(503))
      .mockResolvedValueOnce(mockResponse(200, {
        data: {
          drugs: [{
            id: 'CHEMBL1173655',
            name: 'AFATINIB',
            maximumClinicalStage: 'APPROVAL',
            drugType: 'Small molecule',
            mechanismsOfAction: { uniqueActionTypes: ['INHIBITOR'] },
          }],
        },
      }));

    const ctx = opentargetsBackend.createContext();
    const promise = fetchDrugsByIds(ctx, ['CHEMBL1173655']);
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result).toHaveLength(1);
    expect(result[0]?.name).toBe('AFATINIB');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
