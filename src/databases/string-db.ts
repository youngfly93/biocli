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
import { sleep } from '../utils.js';
import type { HttpContext, FetchOptions } from '../types.js';
import { type DatabaseBackend, registerBackend } from './index.js';

const BASE_URL = 'https://string-db.org/api';
const MAX_RETRIES = 2;
const BASE_RETRY_DELAY_MS = 1000;

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

  let lastError: Error | undefined;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await fetch(url, {
        method: opts?.method ?? 'GET',
        headers: { 'Accept': 'application/json', ...opts?.headers },
        body: opts?.body,
      });

      if (response.status === 429 || response.status === 503) {
        if (attempt < MAX_RETRIES) {
          await sleep(BASE_RETRY_DELAY_MS * Math.pow(2, attempt));
          continue;
        }
        throw new ApiError('STRING API rate limit exceeded. Try again in a few seconds.');
      }

      if (!response.ok) {
        throw new ApiError(`STRING API returned HTTP ${response.status}: ${response.statusText}`);
      }

      return response;
    } catch (err) {
      if (err instanceof ApiError) throw err;
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt < MAX_RETRIES) {
        await sleep(BASE_RETRY_DELAY_MS * Math.pow(2, attempt));
        continue;
      }
    }
  }

  throw new ApiError(
    `STRING request failed after ${MAX_RETRIES + 1} attempts: ${lastError?.message ?? 'unknown error'}`,
  );
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
