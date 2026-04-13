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
import { buildRetryableApiError, buildRetryableRateLimitError, executeHttpRequestWithRetry } from '../retry-policy.js';
import type { HttpContext, FetchOptions } from '../types.js';
import { type DatabaseBackend, registerBackend } from './index.js';

const BASE_URL = 'https://rest.uniprot.org';

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

function buildUniprotHint(finalUrl: string): string {
  const path = decodeURIComponent(new URL(finalUrl).pathname);
  if (path === '/uniprotkb/search') {
    return 'Refine the query and retry with biocli uniprot search <query> -f json.';
  }
  if (/^\/uniprotkb\/[^/]+(?:\.fasta)?$/.test(path)) {
    return 'Run biocli uniprot search <query> -f json to find a valid accession, then retry with biocli uniprot fetch <accession> -f json or biocli uniprot sequence <accession>.';
  }
  return 'Retry with a valid UniProt accession or search query, preferably via biocli uniprot search -f json first.';
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

  return executeHttpRequestWithRetry({
    backendId: 'uniprot',
    execute: () => fetch(finalUrl, {
        method: opts?.method ?? 'GET',
        headers: {
          'Accept': 'application/json',
          ...opts?.headers,
        },
        body: opts?.body,
      }),
    onRetryableStatusExhausted: (status, attempts) => status === 429
      ? buildRetryableRateLimitError(
          `UniProt API rate limit exceeded after ${attempts} attempts`,
          'Check UniProt API at https://rest.uniprot.org',
        )
      : buildRetryableApiError(
          `UniProt API returned HTTP ${status} after ${attempts} attempts`,
          'Check UniProt API at https://rest.uniprot.org',
        ),
    onNonRetryableStatus: (response) => new ApiError(
      `UniProt API returned HTTP ${response.status}: ${response.statusText}`,
      buildUniprotHint(finalUrl),
    ),
    onNetworkErrorExhausted: (error, attempts) => buildRetryableApiError(
      `UniProt request failed after ${attempts} attempts: ${error.message}`,
      'Check UniProt API at https://rest.uniprot.org',
    ),
  });
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
