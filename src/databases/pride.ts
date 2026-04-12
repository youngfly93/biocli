/**
 * PRIDE Archive backend for biocli.
 *
 * PRIDE Archive (https://www.ebi.ac.uk/pride/archive/) is the EBI's mass
 * spectrometry proteomics data repository. It hosts the majority of
 * ProteomeXchange submissions and publishes a rich REST API (OpenAPI v3).
 *
 * Key endpoints used by biocli:
 *   GET /projects/{accession}         — full project metadata (25+ fields)
 *   GET /projects/{accession}/files   — file list with FTP/Aspera URLs
 *   GET /search/projects              — keyword+filter search
 *   GET /stats/submitted-data         — global stats
 *
 * Response format: JSON with heavy use of OBO CvParam objects:
 *   { "@type": "CvParam", "cvLabel": "MS", "accession": "MS:1001742",
 *     "name": "LTQ Orbitrap Velos", "value": "" }
 *
 * Reliability: Generally stable but occasionally flaps. We apply the same
 * exponential backoff as the proteomexchange backend for defense in depth.
 * Rate limit: 5 req/s (faster than PROXI hub, reflects observed stability).
 */

import { getRateLimiterForDatabase } from '../rate-limiter.js';
import { ApiError } from '../errors.js';
import { sleep } from '../utils.js';
import { fetchWithIPv4Fallback } from '../http-dispatcher.js';
import type { HttpContext, FetchOptions } from '../types.js';
import { type DatabaseBackend, registerBackend } from './index.js';

// ── Constants ────────────────────────────────────────────────────────────────

export const PRIDE_BASE_URL =
  process.env.BIOCLI_PRIDE_BASE_URL ?? 'https://www.ebi.ac.uk/pride/ws/archive/v3';

/** Rate limit in req/s. PRIDE is ~3× more reliable than PROXI hub. */
const RATE_LIMIT_RPS = 5;

/** Max retry attempts (initial + 2 retries = 3 total). */
const MAX_RETRIES = 2;

/** Base delay for exponential backoff. Progression: 1s, 2s. */
const BASE_RETRY_DELAY_MS = 1000;

/** HTTP status codes that warrant retry (transient server errors). */
const RETRYABLE_STATUS_CODES = new Set([500, 502, 503, 504]);

// ── URL builder ──────────────────────────────────────────────────────────────

/**
 * Build a PRIDE Archive URL with query parameters.
 *
 * Undefined and empty string params are filtered out.
 *
 * Usage:
 *   buildPrideUrl('/projects/PXD000001')
 *   buildPrideUrl('/search/projects', { keyword: 'phospho', pageSize: '5' })
 */
export function buildPrideUrl(path: string, params?: Record<string, string | undefined>): string {
  const url = new URL(`${PRIDE_BASE_URL}${path}`);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== '') url.searchParams.set(k, String(v));
    }
  }
  return url.toString();
}

function buildPrideHint(finalUrl: string): string {
  const path = decodeURIComponent(new URL(finalUrl).pathname);
  if (/\/projects\/[^/]+\/files$/.test(path)) {
    return 'Run biocli px dataset <PXD> -f json to confirm the accession is public and PRIDE-hosted, then retry with biocli px files <PXD> -f json.';
  }
  if (/\/projects\/[^/]+$/.test(path)) {
    return 'Run biocli px search <query> -f json to find a valid PXD accession, then retry with biocli px dataset <PXD> -f json.';
  }
  if (path.endsWith('/search/projects')) {
    return 'Refine the search terms and retry with biocli px search <query> -f json.';
  }
  return 'Retry with a valid PRIDE accession or search query, or check PRIDE Archive status and try again later.';
}

// ── Low-level fetch with 5xx retry ───────────────────────────────────────────

/**
 * Fetch a PRIDE URL with rate limiting and 5xx exponential backoff.
 * Same retry semantics as the proteomexchange backend.
 */
async function prideFetch(url: string, opts?: FetchOptions): Promise<Response> {
  const parsed = new URL(url);

  if (opts?.params) {
    for (const [k, v] of Object.entries(opts.params)) {
      if (v !== undefined && v !== '') parsed.searchParams.set(k, v);
    }
  }

  const finalUrl = parsed.toString();

  if (!opts?.skipRateLimit) {
    const limiter = getRateLimiterForDatabase('pride', RATE_LIMIT_RPS);
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

      if (RETRYABLE_STATUS_CODES.has(response.status)) {
        lastResponse = response;
        if (attempt < MAX_RETRIES) {
          try { await response.text(); } catch { /* ignore */ }
          const delayMs = BASE_RETRY_DELAY_MS * Math.pow(2, attempt);
          await sleep(delayMs);
          continue;
        }
        throw new ApiError(
          `PRIDE returned HTTP ${response.status} after ${MAX_RETRIES + 1} attempts`,
          'PRIDE Archive may be temporarily unavailable. Retry biocli px dataset/files/search in a minute, or check PRIDE status.',
        );
      }

      if (!response.ok) {
        throw new ApiError(
          `PRIDE returned HTTP ${response.status}: ${response.statusText}`,
          buildPrideHint(finalUrl),
        );
      }

      return response;
    } catch (err) {
      if (err instanceof ApiError) throw err;
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt < MAX_RETRIES) {
        const delayMs = BASE_RETRY_DELAY_MS * Math.pow(2, attempt);
        await sleep(delayMs);
        continue;
      }
    }
  }

  throw new ApiError(
    `PRIDE request failed after ${MAX_RETRIES + 1} attempts: ${lastError?.message ?? `HTTP ${lastResponse?.status ?? 'unknown'}`}`,
    'Retry biocli px dataset/files/search in a minute, or check PRIDE status.',
  );
}

// ── HttpContext factory ──────────────────────────────────────────────────────

function createContext(): HttpContext {
  return {
    databaseId: 'pride',

    async fetch(url: string, opts?: FetchOptions): Promise<Response> {
      return prideFetch(url, opts);
    },

    async fetchJson(url: string, opts?: FetchOptions): Promise<unknown> {
      const response = await prideFetch(url, opts);
      return response.json();
    },

    async fetchXml(url: string, opts?: FetchOptions): Promise<unknown> {
      const response = await prideFetch(url, opts);
      return response.text();
    },

    async fetchText(url: string, opts?: FetchOptions): Promise<string> {
      const response = await prideFetch(url, opts);
      return response.text();
    },
  };
}

// ── Backend registration ─────────────────────────────────────────────────────

export const prideBackend: DatabaseBackend = {
  id: 'pride',
  name: 'PRIDE',
  baseUrl: PRIDE_BASE_URL,
  rateLimit: RATE_LIMIT_RPS,
  createContext,
};

registerBackend(prideBackend);
