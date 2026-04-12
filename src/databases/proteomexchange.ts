/**
 * ProteomeXchange Central Hub backend for biocli.
 *
 * ProteomeXchange Central (ProteomeCentral) implements the PROXI v0.1 spec
 * and federates PRIDE, iProX, MassIVE, and jPOST under a single search
 * interface. Two endpoint styles:
 *
 *   1. Query endpoint  `/datasets?<params>`
 *      Returns a COMPACT tabular format: `datasets[]` is a list of lists
 *      where each row's values map positionally to `result_set.datasets_title_list`.
 *      Adapters MUST zip column titles with row values to produce objects.
 *
 *   2. REST endpoint   `/datasets/{accession}`
 *      Returns a RICH nested single object (contacts, files, instruments,
 *      modifications, etc.). Use this for single-accession fetches —
 *      `?accession=PXD000001` on the query endpoint is silently ignored.
 *
 * Confirmed working parameters (2026-04 via live probing):
 *   search, keywords, modification, repository, instrument, year, contact,
 *   publication, sdrf, files, pageNumber, pageSize
 *
 * Known ignored parameters:
 *   accession  — use REST-style `/datasets/{acc}` path instead
 *   species=<taxid>  — does NOT accept numeric taxonomy IDs; use scientific name
 *
 * Reliability: ProteomeCentral is known to throw transient 500s under load.
 * This backend implements exponential backoff (1s, 2s, max 3 attempts) for
 * 500/502/503/504 only. Permanent codes (501/505+) fail immediately.
 */

import { getRateLimiterForDatabase } from '../rate-limiter.js';
import { ApiError } from '../errors.js';
import { sleep } from '../utils.js';
import { fetchWithIPv4Fallback } from '../http-dispatcher.js';
import type { HttpContext, FetchOptions } from '../types.js';
import { type DatabaseBackend, registerBackend } from './index.js';

// ── Constants ────────────────────────────────────────────────────────────────

export const PROTEOMEXCHANGE_BASE_URL =
  process.env.BIOCLI_PX_BASE_URL ?? 'https://proteomecentral.proteomexchange.org/api/proxi/v0.1';

/** Rate limit in req/s. ProteomeCentral is slow (3–6s/request) and fragile. */
const RATE_LIMIT_RPS = 2;

/** Max retry attempts (including initial). 3 total = initial + 2 retries. */
const MAX_RETRIES = 2;

/** Base delay for exponential backoff. Delays will be 1s, 2s (BASE * 2^attempt). */
const BASE_RETRY_DELAY_MS = 1000;

/** HTTP status codes that warrant retry (transient server errors). */
const RETRYABLE_STATUS_CODES = new Set([500, 502, 503, 504]);

// ── URL builder ──────────────────────────────────────────────────────────────

/**
 * Build a PROXI URL with query parameters.
 *
 * Usage:
 *   buildProxiUrl('/datasets', { keywords: 'phospho', pageSize: '5' })
 *   buildProxiUrl('/datasets/PXD000001')  // REST style for single record
 *
 * Undefined and empty string params are filtered out.
 */
export function buildProxiUrl(path: string, params?: Record<string, string | undefined>): string {
  const url = new URL(`${PROTEOMEXCHANGE_BASE_URL}${path}`);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== '') url.searchParams.set(k, String(v));
    }
  }
  return url.toString();
}

function buildProteomeXchangeHint(finalUrl: string): string {
  const path = decodeURIComponent(new URL(finalUrl).pathname);
  if (/\/datasets\/[^/]+$/.test(path)) {
    return 'Run biocli px search <query> -f json to find a valid PXD accession, then retry with biocli px dataset <PXD> -f json.';
  }
  if (path.endsWith('/datasets')) {
    return 'Adjust the search term or repository filter, then retry with biocli px search <query> -f json.';
  }
  return 'Retry with a valid PXD accession or ProteomeXchange search query.';
}

// ── Low-level fetch with 5xx retry ───────────────────────────────────────────

/**
 * Fetch a PROXI URL with rate limiting and 5xx exponential backoff.
 *
 * Retries on 500/502/503/504 only. Other 5xx (501/505+) fail immediately
 * because they are typically permanent errors (Not Implemented, HTTP
 * Version Not Supported, etc.). 4xx always fails immediately — client
 * errors are not transient.
 */
async function proxiFetch(url: string, opts?: FetchOptions): Promise<Response> {
  const parsed = new URL(url);

  if (opts?.params) {
    for (const [k, v] of Object.entries(opts.params)) {
      if (v !== undefined && v !== '') parsed.searchParams.set(k, v);
    }
  }

  const finalUrl = parsed.toString();

  if (!opts?.skipRateLimit) {
    const limiter = getRateLimiterForDatabase('proteomexchange', RATE_LIMIT_RPS);
    await limiter.acquire();
  }

  let lastResponse: Response | undefined;
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

      // Retryable 5xx — wait and try again.
      if (RETRYABLE_STATUS_CODES.has(response.status)) {
        lastResponse = response;
        if (attempt < MAX_RETRIES) {
          // Consume body so the connection can be freed before we wait.
          try { await response.text(); } catch { /* ignore */ }
          const delayMs = BASE_RETRY_DELAY_MS * Math.pow(2, attempt);
          await sleep(delayMs);
          continue;
        }
        // Exhausted — throw with the final status.
        throw new ApiError(
          `ProteomeXchange returned HTTP ${response.status} after ${MAX_RETRIES + 1} attempts`,
          'The ProteomeCentral hub is currently unreliable. Retry biocli px search/dataset in a minute or two.',
        );
      }

      // Non-retryable error status — throw immediately.
      if (!response.ok) {
        throw new ApiError(
          `ProteomeXchange returned HTTP ${response.status}: ${response.statusText}`,
          buildProteomeXchangeHint(finalUrl),
        );
      }

      return response;
    } catch (err) {
      // Our own ApiError propagates (both retryable-exhausted and non-retryable).
      if (err instanceof ApiError) throw err;
      // Network-level errors (DNS, connect reset, body stream aborted) → retry.
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt < MAX_RETRIES) {
        const delayMs = BASE_RETRY_DELAY_MS * Math.pow(2, attempt);
        await sleep(delayMs);
        continue;
      }
    }
  }

  // Only reached if the final attempt threw a network-level error.
  throw new ApiError(
    `ProteomeXchange request failed after ${MAX_RETRIES + 1} attempts: ${lastError?.message ?? `HTTP ${lastResponse?.status ?? 'unknown'}`}`,
    'Retry biocli px search/dataset in a minute or two, or try a narrower query.',
  );
}

// ── HttpContext factory ──────────────────────────────────────────────────────

function createContext(): HttpContext {
  return {
    databaseId: 'proteomexchange',

    async fetch(url: string, opts?: FetchOptions): Promise<Response> {
      return proxiFetch(url, opts);
    },

    async fetchJson(url: string, opts?: FetchOptions): Promise<unknown> {
      const response = await proxiFetch(url, opts);
      return response.json();
    },

    async fetchXml(url: string, opts?: FetchOptions): Promise<unknown> {
      const response = await proxiFetch(url, opts);
      return response.text();
    },

    async fetchText(url: string, opts?: FetchOptions): Promise<string> {
      const response = await proxiFetch(url, opts);
      return response.text();
    },
  };
}

// ── Backend registration ─────────────────────────────────────────────────────

export const proteomexchangeBackend: DatabaseBackend = {
  id: 'proteomexchange',
  name: 'ProteomeXchange',
  baseUrl: PROTEOMEXCHANGE_BASE_URL,
  rateLimit: RATE_LIMIT_RPS,
  createContext,
};

registerBackend(proteomexchangeBackend);
