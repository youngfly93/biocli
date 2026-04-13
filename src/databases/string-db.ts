/**
 * STRING database backend for biocli.
 *
 * STRING API (https://string-db.org/api):
 *   - No authentication required (optional API key for batch jobs)
 *   - Rate limit: 1 request per second (documented)
 *   - Response format: JSON via /api/json/..., also supports TSV, XML, image
 *   - Multiple identifiers separated by %0d (newline-encoded)
 *   - species parameter: NCBI taxonomy ID (9606 for human)
 */

import { getRateLimiterForDatabase } from '../rate-limiter.js';
import { ApiError } from '../errors.js';
import { buildRetryableApiError, buildRetryableRateLimitError, executeHttpRequestWithRetry } from '../retry-policy.js';
import type { HttpContext, FetchOptions } from '../types.js';
import { type DatabaseBackend, registerBackend } from './index.js';

const BASE_URL = 'https://string-db.org/api';

/** Build a STRING API URL. Format is embedded in path: /api/{format}/{endpoint} */
export function buildStringUrl(endpoint: string, params?: Record<string, string>): string {
  const url = new URL(`${BASE_URL}/json/${endpoint}`);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== '') url.searchParams.set(k, v);
    }
  }
  // Identify ourselves
  if (!url.searchParams.has('caller_identity')) {
    url.searchParams.set('caller_identity', 'biocli');
  }
  return url.toString();
}

/**
 * Encode multiple identifiers for STRING API.
 * STRING uses %0d (URL-encoded newline) as separator.
 */
export function encodeStringIds(ids: string[]): string {
  return ids.join('%0d');
}

/** Low-level STRING fetch with rate limiting and retry. */
async function stringFetch(url: string, opts?: FetchOptions): Promise<Response> {
  if (!opts?.skipRateLimit) {
    const limiter = getRateLimiterForDatabase('string', 1);
    await limiter.acquire();
  }

  return executeHttpRequestWithRetry({
    backendId: 'string',
    execute: () => fetch(url, {
        method: opts?.method ?? 'GET',
        headers: { 'Accept': 'application/json', ...opts?.headers },
        body: opts?.body,
      }),
    onRetryableStatusExhausted: (_status, attempts) => buildRetryableRateLimitError(
      `STRING API rate limit exceeded after ${attempts} attempts`,
      'Check STRING at https://string-db.org',
    ),
    onNonRetryableStatus: (response) => new ApiError(
      `STRING API returned HTTP ${response.status}: ${response.statusText}`,
      'Check STRING at https://string-db.org',
    ),
    onNetworkErrorExhausted: (error, attempts) => buildRetryableApiError(
      `STRING request failed after ${attempts} attempts: ${error.message}`,
      'Check STRING at https://string-db.org',
    ),
  });
}

function createContext(): HttpContext {
  return {
    databaseId: 'string',

    async fetch(url: string, opts?: FetchOptions): Promise<Response> {
      return stringFetch(url, opts);
    },

    async fetchJson(url: string, opts?: FetchOptions): Promise<unknown> {
      const response = await stringFetch(url, opts);
      return response.json();
    },

    async fetchXml(url: string, opts?: FetchOptions): Promise<unknown> {
      const response = await stringFetch(url, opts);
      return response.text();
    },

    async fetchText(url: string, opts?: FetchOptions): Promise<string> {
      const response = await stringFetch(url, opts);
      return response.text();
    },
  };
}

export const stringBackend: DatabaseBackend = {
  id: 'string',
  name: 'STRING',
  baseUrl: BASE_URL,
  rateLimit: 1,
  createContext,
};

registerBackend(stringBackend);
