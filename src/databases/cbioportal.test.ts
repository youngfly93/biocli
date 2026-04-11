import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../errors.js';

const { fetchMock } = vi.hoisted(() => ({ fetchMock: vi.fn() }));
vi.mock('../http-dispatcher.js', async (importOriginal) => {
  const actual = await importOriginal() as Record<string, unknown>;
  return { ...actual, fetchWithIPv4Fallback: fetchMock };
});

import {
  CBIOPORTAL_BASE_URL,
  buildCbioPortalUrl,
  cbioportalBackend,
  fetchAllStudyMolecularProfiles,
  fetchAllStudySampleLists,
  fetchStudy,
  fetchMutationsForProfile,
  selectMutationProfile,
  selectMutationSampleList,
} from './cbioportal.js';

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

describe('cbioportal backend', () => {
  beforeEach(() => {
    fetchMock.mockReset();
  });

  it('registers as the "cbioportal" backend with correct metadata', () => {
    expect(cbioportalBackend.id).toBe('cbioportal');
    expect(cbioportalBackend.name).toBe('cBioPortal');
    expect(cbioportalBackend.baseUrl).toBe(CBIOPORTAL_BASE_URL);
    expect(cbioportalBackend.rateLimit).toBe(5);
  });

  it('happy-path fetchJson returns parsed body', async () => {
    fetchMock.mockResolvedValueOnce(mockResponse(200, [{ studyId: 'breast_msk_2018' }]));
    const ctx = cbioportalBackend.createContext();
    const result = await ctx.fetchJson(
      buildCbioPortalUrl('/studies', { projection: 'SUMMARY' }),
      { skipRateLimit: true },
    );
    expect(result).toEqual([{ studyId: 'breast_msk_2018' }]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('fetchStudy returns study metadata with cancer type context', async () => {
    fetchMock.mockResolvedValueOnce(mockResponse(200, {
      studyId: 'luad_tcga_pan_can_atlas_2018',
      name: 'Lung Adenocarcinoma (TCGA, PanCancer Atlas)',
      cancerType: { name: 'Lung Adenocarcinoma', shortName: 'LUAD', parent: 'nsclc' },
    }));

    const ctx = cbioportalBackend.createContext();
    const result = await fetchStudy(ctx, 'luad_tcga_pan_can_atlas_2018');

    expect(result.studyId).toBe('luad_tcga_pan_can_atlas_2018');
    expect(result.cancerType?.name).toBe('Lung Adenocarcinoma');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('503 then 200 succeeds after one retry', async () => {
    vi.useFakeTimers();
    fetchMock
      .mockResolvedValueOnce(mockResponse(503))
      .mockResolvedValueOnce(mockResponse(200, { ok: true }));

    const ctx = cbioportalBackend.createContext();
    const promise = ctx.fetchJson(
      buildCbioPortalUrl('/studies', { projection: 'SUMMARY' }),
      { skipRateLimit: true },
    );
    await vi.runAllTimersAsync();
    const result = await promise;
    expect(result).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('404 throws ApiError without retry', async () => {
    fetchMock.mockResolvedValueOnce(mockResponse(404));
    const ctx = cbioportalBackend.createContext();
    await expect(
      ctx.fetchJson(buildCbioPortalUrl('/studies/bad-study'), { skipRateLimit: true }),
    ).rejects.toMatchObject({
      hint: expect.stringContaining('biocli cbioportal studies -f json'),
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('mutation profile 404 suggests inspecting profiles instead of exposing a URL', async () => {
    fetchMock.mockResolvedValueOnce(mockResponse(404));
    const ctx = cbioportalBackend.createContext();
    await expect(
      fetchMutationsForProfile(ctx, {
        molecularProfileId: 'bad_profile',
        sampleIds: ['S1'],
      }),
    ).rejects.toMatchObject({
      hint: expect.stringContaining('biocli cbioportal profiles <studyId> -f json'),
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('mutation fetch supports sampleIds-only detailed projection for co-mutation discovery', async () => {
    fetchMock.mockResolvedValueOnce(mockResponse(200, [{
      sampleId: 'S1',
      gene: { entrezGeneId: 1956, hugoGeneSymbol: 'EGFR' },
    }]));

    const ctx = cbioportalBackend.createContext();
    const result = await fetchMutationsForProfile(ctx, {
      molecularProfileId: 'study_mutations',
      sampleIds: ['S1', 'S2'],
      projection: 'DETAILED',
      pageSize: 5,
      pageNumber: 0,
    });

    expect(result).toEqual([{
      sampleId: 'S1',
      gene: { entrezGeneId: 1956, hugoGeneSymbol: 'EGFR' },
    }]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/molecular-profiles/study_mutations/mutations/fetch');
    expect(url).toContain('projection=DETAILED');
    expect(JSON.parse(String(options.body))).toEqual({
      sampleIds: ['S1', 'S2'],
    });
  });

  it('paginates study molecular profiles and sample lists until exhaustion', async () => {
    fetchMock
      .mockResolvedValueOnce(mockResponse(200, [
        { molecularProfileId: 'p1' },
        { molecularProfileId: 'p2' },
      ]))
      .mockResolvedValueOnce(mockResponse(200, [
        { molecularProfileId: 'p3' },
      ]))
      .mockResolvedValueOnce(mockResponse(200, [
        { sampleListId: 's1' },
        { sampleListId: 's2' },
      ]))
      .mockResolvedValueOnce(mockResponse(200, [
        { sampleListId: 's3' },
      ]));

    const ctx = cbioportalBackend.createContext();
    const profiles = await fetchAllStudyMolecularProfiles(ctx, 'study', 2);
    const sampleLists = await fetchAllStudySampleLists(ctx, 'study', 2);

    expect(profiles.map(item => item.molecularProfileId)).toEqual(['p1', 'p2', 'p3']);
    expect(sampleLists.map(item => item.sampleListId)).toEqual(['s1', 's2', 's3']);
    expect(fetchMock).toHaveBeenCalledTimes(4);
    const calls = fetchMock.mock.calls.map(call => String(call[0]));
    expect(calls[0]).toContain('pageNumber=0');
    expect(calls[1]).toContain('pageNumber=1');
    expect(calls[2]).toContain('pageNumber=0');
    expect(calls[3]).toContain('pageNumber=1');
  });
});

describe('buildCbioPortalUrl', () => {
  it('builds the study endpoint with query params', () => {
    const url = buildCbioPortalUrl('/studies', { keyword: 'breast', projection: 'SUMMARY' });
    expect(url).toContain('/studies');
    expect(url).toContain('keyword=breast');
    expect(url).toContain('projection=SUMMARY');
  });
});

describe('cbioportal selectors', () => {
  it('prefers mutation-extended profiles by default', () => {
    const selected = selectMutationProfile([
      { molecularProfileId: 'rna', molecularAlterationType: 'MRNA_EXPRESSION' },
      { molecularProfileId: 'mut', molecularAlterationType: 'MUTATION_EXTENDED' },
    ]);
    expect(selected?.molecularProfileId).toBe('mut');
  });

  it('prefers mutation sample lists and falls back to all cases', () => {
    const selected = selectMutationSampleList([
      { sampleListId: 'study_all', category: 'all_cases_in_study' },
      { sampleListId: 'study_sequenced', category: 'all_cases_with_mutation_data' },
    ]);
    expect(selected?.sampleListId).toBe('study_sequenced');
  });
});
