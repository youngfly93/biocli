/**
 * cBioPortal backend for biocli.
 *
 * cBioPortal public API (https://www.cbioportal.org/api) provides structured
 * cancer genomics data for studies, molecular profiles, sample lists, and
 * mutation calls. biocli uses this backend as the foundation for tumor-focused
 * aggregation commands.
 */

import { getRateLimiterForDatabase } from '../rate-limiter.js';
import { ApiError } from '../errors.js';
import { sleep } from '../utils.js';
import { fetchWithIPv4Fallback } from '../http-dispatcher.js';
import type { HttpContext, FetchOptions } from '../types.js';
import { type DatabaseBackend, registerBackend } from './index.js';

export const CBIOPORTAL_BASE_URL =
  process.env.BIOCLI_CBIOPORTAL_BASE_URL ?? 'https://www.cbioportal.org/api';

const RATE_LIMIT_RPS = 5;
const MAX_RETRIES = 2;
const BASE_RETRY_DELAY_MS = 1000;
const RETRYABLE_STATUS_CODES = new Set([429, 500, 502, 503, 504]);

export interface CbioPortalStudy {
  studyId: string;
  name?: string;
  description?: string;
  cancerTypeId?: string;
  cancerType?: {
    name?: string;
    shortName?: string;
    parent?: string;
    cancerTypeId?: string;
  };
  citation?: string;
  publicStudy?: boolean;
  allSampleCount?: number;
  sequencedSampleCount?: number;
  cnaSampleCount?: number;
}

export interface CbioPortalMolecularProfile {
  molecularProfileId: string;
  molecularAlterationType?: string;
  datatype?: string;
  name?: string;
  description?: string;
  studyId?: string;
}

export interface CbioPortalGene {
  entrezGeneId: number;
  hugoGeneSymbol: string;
  type?: string;
}

export interface CbioPortalSampleList {
  sampleListId: string;
  category?: string;
  name?: string;
  description?: string;
  sampleCount?: number;
  sampleIds?: string[];
  studyId?: string;
}

export interface CbioPortalMutation {
  sampleId?: string;
  patientId?: string;
  studyId?: string;
  molecularProfileId?: string;
  entrezGeneId?: number;
  gene?: CbioPortalGene;
  proteinChange?: string;
  mutationType?: string;
  mutationStatus?: string;
  chr?: string;
  startPosition?: number;
  endPosition?: number;
  variantAllele?: string;
  referenceAllele?: string;
  tumorAltCount?: number;
  tumorRefCount?: number;
  normalRefCount?: number;
  validationStatus?: string;
}

export interface CbioPortalMutationFetchOptions {
  molecularProfileId: string;
  entrezGeneIds?: number[];
  sampleListId?: string;
  sampleIds?: string[];
  pageSize?: number;
  pageNumber?: number;
  projection?: 'SUMMARY' | 'DETAILED';
}

export function buildCbioPortalUrl(
  path: string,
  params?: Record<string, string | undefined>,
): string {
  const url = new URL(`${CBIOPORTAL_BASE_URL}${path}`);
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== '') url.searchParams.set(key, value);
    }
  }
  return url.toString();
}

function buildCbioPortalHint(finalUrl: string): string {
  const url = new URL(finalUrl);
  const path = decodeURIComponent(url.pathname).replace(/\/api(?=\/|$)/, '');

  if (/^\/studies\/[^/]+(?:\/molecular-profiles|\/sample-lists)?$/.test(path)) {
    return 'Run biocli cbioportal studies -f json to find a valid studyId, then retry with --study <studyId>.';
  }
  if (/^\/molecular-profiles\/[^/]+\/mutations\/fetch$/.test(path)) {
    return 'Run biocli cbioportal profiles <studyId> -f json to find a valid molecularProfileId, then retry with --profile <molecularProfileId>.';
  }
  if (/^\/sample-lists\/[^/]+(?:\/sample-ids)?$/.test(path)) {
    return 'Retry without --sample-list to let biocli auto-select a cohort, or use a sampleListId returned for your study.';
  }
  if (path === '/genes/fetch') {
    return 'Retry with a canonical HGNC gene symbol like TP53 or EGFR.';
  }
  return 'Run biocli cbioportal studies -f json to confirm the study and cohort IDs, then retry.';
}

async function cbioPortalFetch(url: string, opts?: FetchOptions): Promise<Response> {
  const parsed = new URL(url);
  if (opts?.params) {
    for (const [key, value] of Object.entries(opts.params)) {
      if (value !== undefined && value !== '') parsed.searchParams.set(key, value);
    }
  }

  const finalUrl = parsed.toString();

  if (!opts?.skipRateLimit) {
    const limiter = getRateLimiterForDatabase('cbioportal', RATE_LIMIT_RPS);
    await limiter.acquire();
  }

  let lastError: Error | undefined;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await fetchWithIPv4Fallback(finalUrl, {
        method: opts?.method ?? 'GET',
        headers: {
          'Accept': 'application/json',
          ...opts?.headers,
        },
        body: opts?.body,
      });

      if (RETRYABLE_STATUS_CODES.has(response.status)) {
        if (attempt < MAX_RETRIES) {
          try { await response.text(); } catch { /* ignore */ }
          await sleep(BASE_RETRY_DELAY_MS * Math.pow(2, attempt));
          continue;
        }
        throw new ApiError(
          `cBioPortal returned HTTP ${response.status} after ${MAX_RETRIES + 1} attempts`,
          `Check cBioPortal at ${CBIOPORTAL_BASE_URL}`,
        );
      }

      if (!response.ok) {
        throw new ApiError(
          `cBioPortal returned HTTP ${response.status}: ${response.statusText}`,
          buildCbioPortalHint(finalUrl),
        );
      }

      return response;
    } catch (error) {
      if (error instanceof ApiError) throw error;
      lastError = error instanceof Error ? error : new Error(String(error));
      if (attempt < MAX_RETRIES) {
        await sleep(BASE_RETRY_DELAY_MS * Math.pow(2, attempt));
        continue;
      }
    }
  }

  throw new ApiError(
    `cBioPortal request failed after ${MAX_RETRIES + 1} attempts: ${lastError?.message ?? 'unknown error'}`,
    `Check cBioPortal at ${CBIOPORTAL_BASE_URL}`,
  );
}

function createContext(): HttpContext {
  return {
    databaseId: 'cbioportal',

    async fetch(url: string, opts?: FetchOptions): Promise<Response> {
      return cbioPortalFetch(url, opts);
    },

    async fetchJson(url: string, opts?: FetchOptions): Promise<unknown> {
      const response = await cbioPortalFetch(url, opts);
      return response.json();
    },

    async fetchXml(url: string, opts?: FetchOptions): Promise<unknown> {
      const response = await cbioPortalFetch(url, opts);
      return response.text();
    },

    async fetchText(url: string, opts?: FetchOptions): Promise<string> {
      const response = await cbioPortalFetch(url, opts);
      return response.text();
    },
  };
}

export async function fetchGenesBySymbol(
  ctx: HttpContext,
  symbol: string,
): Promise<CbioPortalGene[]> {
  const normalized = symbol.trim().toUpperCase();
  return await ctx.fetchJson(
    buildCbioPortalUrl('/genes/fetch', {
      geneIdType: 'HUGO_GENE_SYMBOL',
      projection: 'SUMMARY',
    }),
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify([normalized]),
    },
  ) as CbioPortalGene[];
}

export async function fetchStudyMolecularProfiles(
  ctx: HttpContext,
  studyId: string,
  pageSize = 100,
  pageNumber = 0,
): Promise<CbioPortalMolecularProfile[]> {
  return await ctx.fetchJson(buildCbioPortalUrl(`/studies/${encodeURIComponent(studyId)}/molecular-profiles`, {
    projection: 'SUMMARY',
    pageSize: String(pageSize),
    pageNumber: String(pageNumber),
  })) as CbioPortalMolecularProfile[];
}

export async function fetchStudy(
  ctx: HttpContext,
  studyId: string,
): Promise<CbioPortalStudy> {
  return await ctx.fetchJson(buildCbioPortalUrl(`/studies/${encodeURIComponent(studyId)}`, {
    projection: 'SUMMARY',
  })) as CbioPortalStudy;
}

export async function fetchStudySampleLists(
  ctx: HttpContext,
  studyId: string,
  pageSize = 100,
  pageNumber = 0,
): Promise<CbioPortalSampleList[]> {
  return await ctx.fetchJson(buildCbioPortalUrl(`/studies/${encodeURIComponent(studyId)}/sample-lists`, {
    projection: 'SUMMARY',
    pageSize: String(pageSize),
    pageNumber: String(pageNumber),
  })) as CbioPortalSampleList[];
}

async function fetchAllPages<T>(
  fetchPage: (pageNumber: number) => Promise<T[]>,
  pageSize: number,
  maxPages = 50,
): Promise<T[]> {
  const rows: T[] = [];
  for (let pageNumber = 0; pageNumber < maxPages; pageNumber++) {
    const page = await fetchPage(pageNumber);
    if (!Array.isArray(page) || page.length === 0) break;
    rows.push(...page);
    if (page.length < pageSize) break;
  }
  return rows;
}

export async function fetchAllStudyMolecularProfiles(
  ctx: HttpContext,
  studyId: string,
  pageSize = 100,
): Promise<CbioPortalMolecularProfile[]> {
  return fetchAllPages(
    pageNumber => fetchStudyMolecularProfiles(ctx, studyId, pageSize, pageNumber),
    pageSize,
  );
}

export async function fetchAllStudySampleLists(
  ctx: HttpContext,
  studyId: string,
  pageSize = 100,
): Promise<CbioPortalSampleList[]> {
  return fetchAllPages(
    pageNumber => fetchStudySampleLists(ctx, studyId, pageSize, pageNumber),
    pageSize,
  );
}

export async function fetchSampleList(
  ctx: HttpContext,
  sampleListId: string,
): Promise<CbioPortalSampleList> {
  return await ctx.fetchJson(buildCbioPortalUrl(`/sample-lists/${encodeURIComponent(sampleListId)}`, {
    projection: 'SUMMARY',
  })) as CbioPortalSampleList;
}

export async function fetchSampleIdsForList(
  ctx: HttpContext,
  sampleListId: string,
): Promise<string[]> {
  return await ctx.fetchJson(buildCbioPortalUrl(`/sample-lists/${encodeURIComponent(sampleListId)}/sample-ids`)) as string[];
}

export async function fetchMutationsForProfile(
  ctx: HttpContext,
  opts: CbioPortalMutationFetchOptions,
): Promise<CbioPortalMutation[]> {
  const hasGeneFilter = Array.isArray(opts.entrezGeneIds) && opts.entrezGeneIds.length > 0;
  const hasSampleIds = Array.isArray(opts.sampleIds) && opts.sampleIds.length > 0;
  if (!opts.sampleListId && !hasSampleIds) {
    throw new ApiError(
      'cBioPortal mutation fetch requires sampleListId or sampleIds',
      'Provide a study sample list or a concrete sample cohort before fetching mutations.',
    );
  }
  if (!hasGeneFilter && !hasSampleIds) {
    throw new ApiError(
      'cBioPortal mutation fetch requires entrezGeneIds or sampleIds',
      'Provide a gene filter or a mutated sample set before fetching mutations.',
    );
  }

  const pageSize = Math.max(1, Math.min(opts.pageSize ?? 50, 500));
  const pageNumber = Math.max(0, Math.trunc(opts.pageNumber ?? 0));
  const projection = opts.projection ?? 'SUMMARY';
  const body: Record<string, unknown> = {};
  if (hasGeneFilter) body.entrezGeneIds = opts.entrezGeneIds;
  if (opts.sampleListId) body.sampleListId = opts.sampleListId;
  if (hasSampleIds) body.sampleIds = opts.sampleIds;
  return await ctx.fetchJson(
    buildCbioPortalUrl(`/molecular-profiles/${encodeURIComponent(opts.molecularProfileId)}/mutations/fetch`, {
      projection,
      pageSize: String(pageSize),
      pageNumber: String(pageNumber),
    }),
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
  ) as CbioPortalMutation[];
}

export function selectMutationProfile(
  profiles: CbioPortalMolecularProfile[],
  requestedProfileId?: string,
): CbioPortalMolecularProfile | null {
  if (requestedProfileId) {
    return profiles.find(profile => profile.molecularProfileId === requestedProfileId) ?? null;
  }

  return profiles.find(profile => profile.molecularAlterationType === 'MUTATION_EXTENDED')
    ?? profiles.find(profile => String(profile.molecularAlterationType ?? '').includes('MUTATION'))
    ?? null;
}

export function selectMutationSampleList(
  sampleLists: CbioPortalSampleList[],
  requestedSampleListId?: string,
): CbioPortalSampleList | null {
  if (requestedSampleListId) {
    return sampleLists.find(sampleList => sampleList.sampleListId === requestedSampleListId) ?? null;
  }

  return sampleLists.find(sampleList => sampleList.category === 'all_cases_with_mutation_data')
    ?? sampleLists.find(sampleList => sampleList.sampleListId.endsWith('_sequenced'))
    ?? sampleLists.find(sampleList => sampleList.category === 'all_cases_in_study')
    ?? sampleLists.find(sampleList => sampleList.sampleListId.endsWith('_all'))
    ?? sampleLists[0]
    ?? null;
}

export function sampleListCount(sampleList: CbioPortalSampleList): number {
  if (typeof sampleList.sampleCount === 'number' && Number.isFinite(sampleList.sampleCount)) {
    return sampleList.sampleCount;
  }
  if (Array.isArray(sampleList.sampleIds)) {
    return sampleList.sampleIds.length;
  }
  return 0;
}

export const cbioportalBackend: DatabaseBackend = {
  id: 'cbioportal',
  name: 'cBioPortal',
  baseUrl: CBIOPORTAL_BASE_URL,
  rateLimit: RATE_LIMIT_RPS,
  createContext,
};

registerBackend(cbioportalBackend);
