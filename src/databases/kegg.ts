/**
 * KEGG database backend for biocli.
 *
 * KEGG REST API (https://rest.kegg.jp):
 *   - No authentication required
 *   - Rate limit: undocumented (we use 10/s conservatively)
 *   - Response format: tab-delimited text (NOT JSON) for most endpoints
 *   - Max 10 entries per /get request
 */

import { getRateLimiterForDatabase } from '../rate-limiter.js';
import { ApiError } from '../errors.js';
import { buildRetryableApiError, buildRetryableRateLimitError, executeHttpRequestWithRetry } from '../retry-policy.js';
import type { HttpContext, FetchOptions } from '../types.js';
import { type DatabaseBackend, registerBackend } from './index.js';

const BASE_URL = 'https://rest.kegg.jp';

/** Build a KEGG API URL. */
export function buildKeggUrl(path: string): string {
  return `${BASE_URL}${path}`;
}

/**
 * Parse KEGG tab-delimited response into key-value pairs.
 * Most KEGG endpoints return lines like "hsa:7157\thsa05200"
 */
export function parseKeggTsv(text: string): Array<{ key: string; value: string }> {
  return text.trim().split('\n').filter(Boolean).map(line => {
    const [key, ...rest] = line.split('\t');
    return { key: key?.trim() ?? '', value: rest.join('\t').trim() };
  });
}

/**
 * Parse KEGG flat-file /get response into structured sections.
 * KEGG /get returns a flat-file format with labeled fields.
 */
export function parseKeggEntry(text: string): Record<string, string> {
  const result: Record<string, string> = {};
  let currentKey = '';
  let currentValue = '';

  for (const line of text.split('\n')) {
    if (line === '///') break; // end of entry

    const match = line.match(/^([A-Z_]+)\s+(.*)/);
    if (match) {
      if (currentKey) result[currentKey] = currentValue.trim();
      currentKey = match[1];
      currentValue = match[2];
    } else if (line.startsWith('            ') || line.startsWith('  ')) {
      // Continuation line
      currentValue += ' ' + line.trim();
    }
  }
  if (currentKey) result[currentKey] = currentValue.trim();

  return result;
}

/** Low-level KEGG fetch with rate limiting and retry. */
async function keggFetch(url: string, opts?: FetchOptions): Promise<Response> {
  if (!opts?.skipRateLimit) {
    const limiter = getRateLimiterForDatabase('kegg', 10);
    await limiter.acquire();
  }

  return executeHttpRequestWithRetry({
    backendId: 'kegg',
    execute: () => fetch(url, {
        method: opts?.method ?? 'GET',
        headers: opts?.headers,
        body: opts?.body,
      }),
    onRetryableStatusExhausted: (_status, attempts) => buildRetryableRateLimitError(
      `KEGG API rate limit exceeded after ${attempts} attempts`,
      'Check KEGG API at https://rest.kegg.jp',
    ),
    onNonRetryableStatus: (response) => {
      if (response.status === 404) {
        return new ApiError('KEGG entry not found', 'Check the KEGG ID is valid at https://www.kegg.jp');
      }
      return new ApiError(
        `KEGG API returned HTTP ${response.status}: ${response.statusText}`,
        'Check KEGG API at https://rest.kegg.jp',
      );
    },
    onNetworkErrorExhausted: (error, attempts) => buildRetryableApiError(
      `KEGG request failed after ${attempts} attempts: ${error.message}`,
      'Check KEGG API at https://rest.kegg.jp',
    ),
  });
}

/** Create a KEGG HttpContext. */
function createContext(): HttpContext {
  return {
    databaseId: 'kegg',

    async fetch(url: string, opts?: FetchOptions): Promise<Response> {
      return keggFetch(url, opts);
    },

    async fetchJson(url: string, opts?: FetchOptions): Promise<unknown> {
      // KEGG rarely returns JSON; parse TSV into array of objects
      const response = await keggFetch(url, opts);
      const text = await response.text();
      try {
        return JSON.parse(text);
      } catch {
        // Not JSON — return as parsed TSV
        return parseKeggTsv(text);
      }
    },

    async fetchXml(url: string, opts?: FetchOptions): Promise<unknown> {
      const response = await keggFetch(url, opts);
      return response.text();
    },

    async fetchText(url: string, opts?: FetchOptions): Promise<string> {
      const response = await keggFetch(url, opts);
      return response.text();
    },
  };
}

// ── Backend registration ─────────────────────────────────────────────────────

export const keggBackend: DatabaseBackend = {
  id: 'kegg',
  name: 'KEGG',
  baseUrl: BASE_URL,
  rateLimit: 10,
  createContext,
};

registerBackend(keggBackend);
