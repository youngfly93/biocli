/**
 * Ensembl database backend for biocli.
 *
 * Ensembl REST API (https://rest.ensembl.org):
 *   - No authentication required
 *   - Rate limit: 15 req/s, 55,000 req/hr (strictly enforced)
 *   - Returns HTTP 429 with Retry-After header when exceeded
 *   - Response format: JSON (default), XML
 *   - GRCh37: https://grch37.rest.ensembl.org
 */

import { getRateLimiterForDatabase } from '../rate-limiter.js';
import { ApiError } from '../errors.js';
import { sleep } from '../utils.js';
import type { HttpContext, FetchOptions } from '../types.js';
import { type DatabaseBackend, registerBackend } from './index.js';

const BASE_URL = 'https://rest.ensembl.org';
const MAX_RETRIES = 3;
const BASE_RETRY_DELAY_MS = 500;

/** Build an Ensembl API URL. */
export function buildEnsemblUrl(path: string, params?: Record<string, string>): string {
  const url = new URL(`${BASE_URL}${path}`);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== '') url.searchParams.set(k, v);
    }
  }
  return url.toString();
}

/**
 * Detect whether a string is an Ensembl stable ID.
 * Ensembl IDs: ENSG (gene), ENST (transcript), ENSP (protein), ENSE (exon),
 * ENSR (regulatory), plus species-specific prefixes (e.g. ENSMUSG for mouse).
 */
export function isEnsemblId(value: string): boolean {
  return /^ENS[A-Z]*[GTSEPRF]\d{11}(\.\d+)?$/.test(value);
}

/** Low-level Ensembl fetch with rate limiting and retry. */
async function ensemblFetch(url: string, opts?: FetchOptions): Promise<Response> {
  if (!opts?.skipRateLimit) {
    const limiter = getRateLimiterForDatabase('ensembl', 15);
    await limiter.acquire();
  }

  let lastError: Error | undefined;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await fetch(url, {
        method: opts?.method ?? 'GET',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          ...opts?.headers,
        },
        body: opts?.body,
      });

      if (response.status === 429) {
        const retryAfter = response.headers.get('Retry-After');
        const delayMs = retryAfter
          ? parseFloat(retryAfter) * 1000
          : BASE_RETRY_DELAY_MS * Math.pow(2, attempt);
        if (attempt < MAX_RETRIES) {
          await sleep(delayMs);
          continue;
        }
        throw new ApiError('Ensembl API rate limit exceeded. Try again later.', 'Check Ensembl REST API at https://rest.ensembl.org');
      }

      if (response.status === 400) {
        const body = await response.text();
        throw new ApiError(`Ensembl API error: ${body}`, 'Check Ensembl REST API at https://rest.ensembl.org');
      }

      if (!response.ok) {
        throw new ApiError(`Ensembl API returned HTTP ${response.status}: ${response.statusText}`, 'Check Ensembl REST API at https://rest.ensembl.org');
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
    `Ensembl request failed after ${MAX_RETRIES + 1} attempts: ${lastError?.message ?? 'unknown error'}`,
    'Check Ensembl REST API at https://rest.ensembl.org',
  );
}

function createContext(): HttpContext {
  return {
    databaseId: 'ensembl',

    async fetch(url: string, opts?: FetchOptions): Promise<Response> {
      return ensemblFetch(url, opts);
    },

    async fetchJson(url: string, opts?: FetchOptions): Promise<unknown> {
      const response = await ensemblFetch(url, opts);
      return response.json();
    },

    async fetchXml(url: string, opts?: FetchOptions): Promise<unknown> {
      const response = await ensemblFetch(url, opts);
      return response.text();
    },

    async fetchText(url: string, opts?: FetchOptions): Promise<string> {
      const response = await ensemblFetch(url, opts);
      return response.text();
    },
  };
}

export const ensemblBackend: DatabaseBackend = {
  id: 'ensembl',
  name: 'Ensembl',
  baseUrl: BASE_URL,
  rateLimit: 15,
  createContext,
};

registerBackend(ensemblBackend);
