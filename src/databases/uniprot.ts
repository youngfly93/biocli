/**
 * UniProt database backend for biocli.
 *
 * UniProt REST API (https://rest.uniprot.org):
 *   - No authentication required
 *   - Rate limit: ~200 req/s (we cap at 50/s to be polite)
 *   - Response format: JSON (default), XML, TSV, FASTA
 *   - Pagination via Link headers
 */

import { getRateLimiterForDatabase } from '../rate-limiter.js';
import { ApiError } from '../errors.js';
import { sleep } from '../utils.js';
import type { HttpContext, FetchOptions } from '../types.js';
import { type DatabaseBackend, registerBackend } from './index.js';

const BASE_URL = 'https://rest.uniprot.org';
const MAX_RETRIES = 2;
const BASE_RETRY_DELAY_MS = 500;

/** Build a UniProt API URL with query parameters. */
export function buildUniprotUrl(path: string, params?: Record<string, string>): string {
  const url = new URL(`${BASE_URL}${path}`);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== '') url.searchParams.set(k, v);
    }
  }
  return url.toString();
}

/** Low-level UniProt fetch with rate limiting and retry. */
async function uniprotFetch(url: string, opts?: FetchOptions): Promise<Response> {
  const parsed = new URL(url);

  if (opts?.params) {
    for (const [k, v] of Object.entries(opts.params)) {
      if (v !== undefined && v !== '') parsed.searchParams.set(k, v);
    }
  }

  const finalUrl = parsed.toString();

  if (!opts?.skipRateLimit) {
    const limiter = getRateLimiterForDatabase('uniprot', 50);
    await limiter.acquire();
  }

  let lastError: Error | undefined;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await fetch(finalUrl, {
        method: opts?.method ?? 'GET',
        headers: {
          'Accept': 'application/json',
          ...opts?.headers,
        },
        body: opts?.body,
      });

      if (response.status === 429) {
        if (attempt < MAX_RETRIES) {
          const retryAfter = response.headers.get('Retry-After');
          const delayMs = retryAfter
            ? parseInt(retryAfter, 10) * 1000
            : BASE_RETRY_DELAY_MS * Math.pow(2, attempt);
          await sleep(delayMs);
          continue;
        }
        throw new ApiError('UniProt API rate limit exceeded', 'Check UniProt API at https://rest.uniprot.org');
      }

      if (!response.ok) {
        throw new ApiError(
          `UniProt API returned HTTP ${response.status}: ${response.statusText}`,
          `Request URL: ${finalUrl}`,
        );
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
    `UniProt request failed after ${MAX_RETRIES + 1} attempts: ${lastError?.message ?? 'unknown error'}`,
    'Check UniProt API at https://rest.uniprot.org',
  );
}

/** Create a UniProt HttpContext. */
function createContext(): HttpContext {
  return {
    databaseId: 'uniprot',

    async fetch(url: string, opts?: FetchOptions): Promise<Response> {
      return uniprotFetch(url, opts);
    },

    async fetchJson(url: string, opts?: FetchOptions): Promise<unknown> {
      const response = await uniprotFetch(url, opts);
      return response.json();
    },

    async fetchXml(url: string, opts?: FetchOptions): Promise<unknown> {
      const response = await uniprotFetch(url, opts);
      return response.text(); // caller can parse XML if needed
    },

    async fetchText(url: string, opts?: FetchOptions): Promise<string> {
      const response = await uniprotFetch(url, opts);
      return response.text();
    },
  };
}

// ── Backend registration ─────────────────────────────────────────────────────

export const uniprotBackend: DatabaseBackend = {
  id: 'uniprot',
  name: 'UniProt',
  baseUrl: BASE_URL,
  rateLimit: 50,
  createContext,
};

registerBackend(uniprotBackend);
