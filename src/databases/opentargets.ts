/**
 * Open Targets backend for biocli.
 *
 * Open Targets Platform exposes a public GraphQL API for target-centric
 * disease and drug evidence. biocli uses this backend for drug-target
 * aggregation and future oncology workflows.
 */

import { getRateLimiterForDatabase } from '../rate-limiter.js';
import { ApiError } from '../errors.js';
import { sleep } from '../utils.js';
import { fetchWithIPv4Fallback } from '../http-dispatcher.js';
import type { FetchOptions, HttpContext } from '../types.js';
import { isEnsemblId } from './ensembl.js';
import { type DatabaseBackend, registerBackend } from './index.js';

export const OPENTARGETS_BASE_URL =
  process.env.BIOCLI_OPENTARGETS_BASE_URL ?? 'https://api.platform.opentargets.org/api/v4/graphql';

const RATE_LIMIT_RPS = 4;
const MAX_RETRIES = 2;
const BASE_RETRY_DELAY_MS = 1000;
const RETRYABLE_STATUS_CODES = new Set([429, 500, 502, 503, 504]);

export interface OpenTargetsSearchHit {
  id: string;
  entity: string;
  object?: {
    approvedSymbol?: string;
    approvedName?: string;
    biotype?: string;
  };
}

export interface OpenTargetsDisease {
  id: string;
  name: string;
}

export interface OpenTargetsAssociatedDiseaseRow {
  disease: OpenTargetsDisease | null;
  score: number;
}

export interface OpenTargetsTractabilityRow {
  label: string;
  modality: string;
  value: boolean;
}

export interface OpenTargetsClinicalDiseaseRow {
  diseaseFromSource?: string;
  disease: OpenTargetsDisease | null;
}

export interface OpenTargetsClinicalReport {
  id: string;
  source: string;
  clinicalStage: string;
  trialPhase?: string | null;
  year?: number | null;
  title?: string | null;
  url?: string | null;
}

export interface OpenTargetsDrugSummary {
  id: string;
  name: string;
  maximumClinicalStage: string;
  drugType: string;
}

export interface OpenTargetsDrugDetail extends OpenTargetsDrugSummary {
  mechanismsOfAction?: {
    uniqueActionTypes: string[];
  } | null;
}

export interface OpenTargetsClinicalTargetRow {
  id: string;
  maxClinicalStage: string;
  drug: OpenTargetsDrugSummary | null;
  diseases: OpenTargetsClinicalDiseaseRow[];
  clinicalReports: OpenTargetsClinicalReport[];
}

export interface OpenTargetsResolvedTarget {
  id: string;
  approvedSymbol: string;
  approvedName?: string;
  biotype?: string;
}

export interface OpenTargetsTargetSnapshot extends OpenTargetsResolvedTarget {
  tractability: OpenTargetsTractabilityRow[];
  associatedDiseases: {
    count: number;
    rows: OpenTargetsAssociatedDiseaseRow[];
  };
  drugAndClinicalCandidates: {
    count: number;
    rows: OpenTargetsClinicalTargetRow[];
  };
}

interface GraphqlResponse<T> {
  data?: T;
  errors?: Array<{ message?: string }>;
}

function buildOpenTargetsError(message: string, details?: string): ApiError {
  return new ApiError(
    message,
    details ?? `Check Open Targets GraphQL API at ${OPENTARGETS_BASE_URL}`,
  );
}

function extractGraphqlOperationName(body: unknown): string | undefined {
  if (typeof body !== 'string') return undefined;
  try {
    const payload = JSON.parse(body) as { query?: unknown };
    if (typeof payload.query !== 'string') return undefined;
    return payload.query.match(/\bquery\s+([A-Za-z0-9_]+)/)?.[1];
  } catch {
    return undefined;
  }
}

function buildOpenTargetsHint(body?: unknown): string {
  const operation = extractGraphqlOperationName(body);
  if (operation === 'SearchTargets') {
    return 'Retry with a canonical HGNC symbol or Ensembl gene ID. Example: biocli aggregate drug-target EGFR -f json.';
  }
  if (operation === 'TargetDrugSnapshot') {
    return 'Retry with a valid Ensembl gene ID, or start from biocli aggregate drug-target <gene> -f json and let biocli resolve the target.';
  }
  if (operation === 'DrugsByIds') {
    return 'Retry after resolving the target with biocli aggregate drug-target <gene> -f json so you have valid ChEMBL drug IDs.';
  }
  return 'Retry biocli aggregate drug-target <gene> -f json with a canonical HGNC symbol like EGFR or TP53.';
}

async function openTargetsFetch(url: string, opts?: FetchOptions): Promise<Response> {
  const finalUrl = url;

  if (!opts?.skipRateLimit) {
    const limiter = getRateLimiterForDatabase('opentargets', RATE_LIMIT_RPS);
    await limiter.acquire();
  }

  let lastError: Error | undefined;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await fetchWithIPv4Fallback(finalUrl, {
        method: opts?.method ?? 'POST',
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
        throw buildOpenTargetsError(
          `Open Targets returned HTTP ${response.status} after ${MAX_RETRIES + 1} attempts`,
          buildOpenTargetsHint(opts?.body),
        );
      }

      if (!response.ok) {
        throw buildOpenTargetsError(
          `Open Targets returned HTTP ${response.status}: ${response.statusText}`,
          buildOpenTargetsHint(opts?.body),
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

  throw buildOpenTargetsError(
    `Open Targets request failed after ${MAX_RETRIES + 1} attempts: ${lastError?.message ?? 'unknown error'}`,
    buildOpenTargetsHint(opts?.body),
  );
}

function createContext(): HttpContext {
  return {
    databaseId: 'opentargets',

    async fetch(url: string, opts?: FetchOptions): Promise<Response> {
      return openTargetsFetch(url, opts);
    },

    async fetchJson(url: string, opts?: FetchOptions): Promise<unknown> {
      const response = await openTargetsFetch(url, opts);
      return response.json();
    },

    async fetchXml(url: string, opts?: FetchOptions): Promise<unknown> {
      const response = await openTargetsFetch(url, opts);
      return response.text();
    },

    async fetchText(url: string, opts?: FetchOptions): Promise<string> {
      const response = await openTargetsFetch(url, opts);
      return response.text();
    },
  };
}

async function queryOpenTargets<TData>(
  ctx: HttpContext,
  query: string,
  variables?: Record<string, unknown>,
): Promise<TData> {
  const payload = await ctx.fetchJson(OPENTARGETS_BASE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables }),
  }) as GraphqlResponse<TData>;

  if (payload.errors?.length) {
    const messages = payload.errors
      .map(item => String(item?.message ?? '').trim())
      .filter(Boolean)
      .join('; ');
    throw buildOpenTargetsError(
      `Open Targets GraphQL query failed${messages ? `: ${messages}` : ''}`,
    );
  }
  if (!payload.data) {
    throw buildOpenTargetsError('Open Targets GraphQL response did not include data');
  }
  return payload.data;
}

const SEARCH_TARGETS_QUERY = `
  query SearchTargets($queryString: String!) {
    search(queryString: $queryString, entityNames: ["target"]) {
      total
      hits {
        id
        entity
        object {
          ... on Target {
            approvedSymbol
            approvedName
            biotype
          }
        }
      }
    }
  }
`;

const TARGET_DRUG_SNAPSHOT_QUERY = `
  query TargetDrugSnapshot($ensemblId: String!, $diseasePageIndex: Int!, $diseasePageSize: Int!) {
    target(ensemblId: $ensemblId) {
      id
      approvedSymbol
      approvedName
      biotype
      tractability {
        label
        modality
        value
      }
      associatedDiseases(page: { index: $diseasePageIndex, size: $diseasePageSize }) {
        count
        rows {
          disease {
            id
            name
          }
          score
        }
      }
      drugAndClinicalCandidates {
        count
        rows {
          id
          maxClinicalStage
          drug {
            id
            name
            maximumClinicalStage
            drugType
          }
          diseases {
            diseaseFromSource
            disease {
              id
              name
            }
          }
          clinicalReports {
            id
            source
            clinicalStage
            trialPhase
            year
            title
            url
          }
        }
      }
    }
  }
`;

const DRUGS_BY_IDS_QUERY = `
  query DrugsByIds($chemblIds: [String!]!) {
    drugs(chemblIds: $chemblIds) {
      id
      name
      maximumClinicalStage
      drugType
      mechanismsOfAction {
        uniqueActionTypes
      }
    }
  }
`;

export async function searchTargets(
  ctx: HttpContext,
  queryString: string,
): Promise<OpenTargetsSearchHit[]> {
  const data = await queryOpenTargets<{
    search: { hits?: OpenTargetsSearchHit[] | null } | null;
  }>(ctx, SEARCH_TARGETS_QUERY, { queryString });
  return data.search?.hits?.filter(hit => hit.entity === 'target') ?? [];
}

export async function resolveTarget(
  ctx: HttpContext,
  geneOrEnsemblId: string,
): Promise<OpenTargetsResolvedTarget | null> {
  const query = geneOrEnsemblId.trim();
  if (!query) return null;

  if (isEnsemblId(query)) {
    const snapshot = await fetchTargetDrugSnapshot(ctx, query, 0, 1);
    if (!snapshot) return null;
    return {
      id: snapshot.id,
      approvedSymbol: snapshot.approvedSymbol,
      approvedName: snapshot.approvedName,
      biotype: snapshot.biotype,
    };
  }

  const hits = await searchTargets(ctx, query);
  const normalized = query.toUpperCase();
  const exact = hits.find(hit => String(hit.object?.approvedSymbol ?? '').toUpperCase() === normalized);
  const fallback = hits.find(hit => hit.object?.biotype === 'protein_coding') ?? hits[0];
  const selected = exact ?? fallback;
  if (!selected?.id || !selected.object?.approvedSymbol) return null;
  return {
    id: selected.id,
    approvedSymbol: selected.object.approvedSymbol,
    approvedName: selected.object.approvedName,
    biotype: selected.object.biotype,
  };
}

export async function fetchTargetDrugSnapshot(
  ctx: HttpContext,
  ensemblId: string,
  diseasePageIndex = 0,
  diseasePageSize = 10,
): Promise<OpenTargetsTargetSnapshot | null> {
  const data = await queryOpenTargets<{
    target: OpenTargetsTargetSnapshot | null;
  }>(ctx, TARGET_DRUG_SNAPSHOT_QUERY, {
    ensemblId,
    diseasePageIndex,
    diseasePageSize,
  });
  return data.target;
}

export async function fetchDrugsByIds(
  ctx: HttpContext,
  chemblIds: string[],
): Promise<OpenTargetsDrugDetail[]> {
  const uniqueIds = [...new Set(chemblIds.map(id => id.trim()).filter(Boolean))];
  if (uniqueIds.length === 0) return [];

  const data = await queryOpenTargets<{
    drugs: OpenTargetsDrugDetail[];
  }>(ctx, DRUGS_BY_IDS_QUERY, { chemblIds: uniqueIds });

  return data.drugs ?? [];
}

export const opentargetsBackend: DatabaseBackend = {
  id: 'opentargets',
  name: 'Open Targets',
  baseUrl: OPENTARGETS_BASE_URL,
  rateLimit: RATE_LIMIT_RPS,
  createContext,
};

registerBackend(opentargetsBackend);
