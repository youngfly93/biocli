/**
 * NCBI database backend for biocli.
 *
 * Provides an NCBI-aware HTTP client that automatically:
 *   - Injects api_key and email into URL params
 *   - Applies rate limiting (3/s anonymous, 10/s with API key)
 *   - Retries on HTTP 429 with exponential backoff
 *   - Parses XML and JSON responses
 *
 * Refactored from the original ncbi-fetch.ts into the DatabaseBackend
 * pattern. The original ncbi-fetch.ts is kept as a re-export shim.
 */

import { getApiKey, getEmail } from '../config.js';
import { getRateLimiter } from '../rate-limiter.js';
import { parseXml } from '../xml-parser.js';
import { RateLimitError, ApiError } from '../errors.js';
import { sleep } from '../utils.js';
import type { HttpContext, FetchOptions } from '../types.js';
import { type DatabaseBackend, registerBackend } from './index.js';

// ── Constants ────────────────────────────────────────────────────────────────

export const EUTILS_BASE = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils';

/** Maximum number of retries on HTTP 429 responses. */
const MAX_RETRIES = 3;

/** Base delay in ms for exponential backoff (doubled on each retry). */
const BASE_RETRY_DELAY_MS = 500;

/** Tool parameter sent to NCBI to identify this client. */
const TOOL_NAME = 'biocli';

// ── URL builder ──────────────────────────────────────────────────────────────

/**
 * Build a full E-utilities URL for a given tool endpoint.
 */
export function buildEutilsUrl(tool: string, params: Record<string, string>): string {
  const url = new URL(`${EUTILS_BASE}/${tool}`);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== '') url.searchParams.set(k, v);
  }
  return url.toString();
}

// ── Core fetch ───────────────────────────────────────────────────────────────

/**
 * Low-level NCBI fetch with rate limiting and retry.
 */
export async function ncbiFetch(
  url: string,
  opts?: FetchOptions,
  apiKey?: string,
  email?: string,
): Promise<Response> {
  const parsed = new URL(url);

  if (opts?.params) {
    for (const [k, v] of Object.entries(opts.params)) {
      if (v !== undefined && v !== '') parsed.searchParams.set(k, v);
    }
  }

  if (apiKey && !parsed.searchParams.has('api_key')) {
    parsed.searchParams.set('api_key', apiKey);
  }
  if (email && !parsed.searchParams.has('email')) {
    parsed.searchParams.set('email', email);
  }
  if (!parsed.searchParams.has('tool')) {
    parsed.searchParams.set('tool', TOOL_NAME);
  }

  const finalUrl = parsed.toString();

  if (!opts?.skipRateLimit) {
    const limiter = getRateLimiter(!!apiKey);
    await limiter.acquire();
  }

  let lastError: Error | undefined;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await fetch(finalUrl, {
        method: opts?.method ?? 'GET',
        headers: opts?.headers,
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
        throw new RateLimitError(
          `NCBI returned 429 after ${MAX_RETRIES + 1} attempts`,
        );
      }

      if (!response.ok) {
        throw new ApiError(
          `NCBI API returned HTTP ${response.status}: ${response.statusText}`,
          `Request URL: ${finalUrl.replace(/api_key=[^&]+/, 'api_key=***')}`,
        );
      }

      return response;
    } catch (err) {
      if (err instanceof RateLimitError || err instanceof ApiError) {
        throw err;
      }
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt < MAX_RETRIES) {
        await sleep(BASE_RETRY_DELAY_MS * Math.pow(2, attempt));
        continue;
      }
    }
  }

  throw new ApiError(
    `NCBI request failed after ${MAX_RETRIES + 1} attempts: ${lastError?.message ?? 'unknown error'}`,
  );
}

// ── HttpContext factory ──────────────────────────────────────────────────────

/**
 * Create an NCBI HttpContext for command execution.
 */
export function createHttpContext(): HttpContext {
  const apiKey = getApiKey();
  const email = getEmail();

  getRateLimiter(!!apiKey);

  return {
    databaseId: 'ncbi',
    apiKey,
    email,
    credentials: {
      ...(apiKey ? { api_key: apiKey } : {}),
      ...(email ? { email } : {}),
    },

    async fetch(url: string, opts?: FetchOptions): Promise<Response> {
      return ncbiFetch(url, opts, apiKey, email);
    },

    async fetchXml(url: string, opts?: FetchOptions): Promise<unknown> {
      const response = await ncbiFetch(url, opts, apiKey, email);
      const text = await response.text();
      return parseXml(text);
    },

    async fetchJson(url: string, opts?: FetchOptions): Promise<unknown> {
      const response = await ncbiFetch(url, opts, apiKey, email);
      return response.json();
    },

    async fetchText(url: string, opts?: FetchOptions): Promise<string> {
      const response = await ncbiFetch(url, opts, apiKey, email);
      return response.text();
    },
  };
}

// ── Backend registration ─────────────────────────────────────────────────────

export const ncbiBackend: DatabaseBackend = {
  id: 'ncbi',
  name: 'NCBI',
  baseUrl: EUTILS_BASE,
  rateLimit: 3,
  createContext: createHttpContext,
};

registerBackend(ncbiBackend);
