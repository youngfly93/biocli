/**
 * Enrichr database backend for biocli.
 *
 * Enrichr API (https://maayanlab.cloud/Enrichr):
 *   - No authentication required
 *   - Rate limit: undocumented (we use 5/s conservatively)
 *   - 2-step workflow: POST /addList → GET /enrich
 *   - Response format: JSON
 *
 * Popular gene set libraries:
 *   KEGG_2021_Human, GO_Biological_Process_2023, GO_Molecular_Function_2023,
 *   GO_Cellular_Component_2023, WikiPathway_2023_Human, Reactome_2022,
 *   MSigDB_Hallmark_2020, DisGeNET, OMIM_Disease, GWAS_Catalog_2023
 */

import { getRateLimiterForDatabase } from '../rate-limiter.js';
import { ApiError } from '../errors.js';
import { buildRetryableApiError, buildRetryableRateLimitError, executeHttpRequestWithRetry } from '../retry-policy.js';
import type { HttpContext, FetchOptions } from '../types.js';
import { type DatabaseBackend, registerBackend } from './index.js';

const BASE_URL = 'https://maayanlab.cloud/Enrichr';

/** Enrichr fetch options — extends FetchOptions with FormData support. */
interface EnrichrFetchOptions extends FetchOptions {
  formData?: FormData;
}

/** Low-level Enrichr fetch. */
async function enrichrFetch(url: string, opts?: EnrichrFetchOptions): Promise<Response> {
  if (!opts?.skipRateLimit) {
    const limiter = getRateLimiterForDatabase('enrichr', 5);
    await limiter.acquire();
  }

  return executeHttpRequestWithRetry({
    backendId: 'enrichr',
    execute: () => fetch(url, {
        method: opts?.method ?? 'GET',
        headers: opts?.formData ? undefined : opts?.headers,
        body: opts?.formData ?? opts?.body,
      }),
    onRetryableStatusExhausted: (status, attempts) => status === 429
      ? buildRetryableRateLimitError(
          `Enrichr API rate limit exceeded after ${attempts} attempts`,
          'Check Enrichr at https://maayanlab.cloud/Enrichr',
        )
      : buildRetryableApiError(
          `Enrichr API returned HTTP ${status} after ${attempts} attempts`,
          'Check Enrichr at https://maayanlab.cloud/Enrichr',
        ),
    onNonRetryableStatus: (response) => new ApiError(
      `Enrichr API returned HTTP ${response.status}: ${response.statusText}`,
      'Check Enrichr at https://maayanlab.cloud/Enrichr',
    ),
    onNetworkErrorExhausted: (error, attempts) => buildRetryableApiError(
      `Enrichr request failed after ${attempts} attempts: ${error.message}`,
      'Check Enrichr at https://maayanlab.cloud/Enrichr',
    ),
  });
}

/**
 * Submit a gene list to Enrichr and return the userListId.
 * This is step 1 of the 2-step workflow.
 *
 * NOTE: Enrichr requires multipart/form-data (not URL-encoded).
 */
export async function submitGeneList(genes: string[], description?: string): Promise<number> {
  const formData = new FormData();
  formData.set('list', genes.join('\n'));
  formData.set('description', description ?? 'biocli analysis');

  // FormData sets Content-Type with boundary automatically
  const response = await enrichrFetch(`${BASE_URL}/addList`, {
    method: 'POST',
    formData,
  });

  const data = await response.json() as Record<string, unknown>;
  const userListId = data.userListId;
  if (typeof userListId !== 'number') {
    throw new ApiError('Enrichr did not return a valid userListId', 'Check Enrichr at https://maayanlab.cloud/Enrichr');
  }
  return userListId;
}

/**
 * Get enrichment results for a submitted gene list.
 * This is step 2 of the 2-step workflow.
 */
export async function getEnrichment(
  userListId: number,
  library: string,
): Promise<Record<string, unknown>[]> {
  const response = await enrichrFetch(
    `${BASE_URL}/enrich?userListId=${userListId}&backgroundType=${encodeURIComponent(library)}`,
  );

  const data = await response.json() as Record<string, unknown>;
  const results = data[library];
  if (!Array.isArray(results)) return [];

  // Enrichr returns arrays of arrays:
  // [rank, term_name, p_value, z_score, combined_score, [overlapping_genes], adj_p, old_p, old_adj_p]
  return results.map((row: unknown[]) => ({
    rank: Number(row[0] ?? 0),
    term: String(row[1] ?? ''),
    pValue: Number(row[2] ?? 1),
    zScore: Number(row[3] ?? 0),
    combinedScore: Number(row[4] ?? 0),
    genes: Array.isArray(row[5]) ? (row[5] as string[]).join(',') : '',
    adjustedPValue: Number(row[6] ?? 1),
  }));
}

function createContext(): HttpContext {
  return {
    databaseId: 'enrichr',

    async fetch(url: string, opts?: FetchOptions): Promise<Response> {
      return enrichrFetch(url, opts);
    },

    async fetchJson(url: string, opts?: FetchOptions): Promise<unknown> {
      const response = await enrichrFetch(url, opts);
      return response.json();
    },

    async fetchXml(url: string, opts?: FetchOptions): Promise<unknown> {
      const response = await enrichrFetch(url, opts);
      return response.text();
    },

    async fetchText(url: string, opts?: FetchOptions): Promise<string> {
      const response = await enrichrFetch(url, opts);
      return response.text();
    },
  };
}

export const enrichrBackend: DatabaseBackend = {
  id: 'enrichr',
  name: 'Enrichr',
  baseUrl: BASE_URL,
  rateLimit: 5,
  createContext,
};

registerBackend(enrichrBackend);
