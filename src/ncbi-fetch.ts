/**
 * NCBI-aware HTTP client.
 *
 * Provides fetch wrappers that automatically:
 *   - Inject api_key and email into URL params
 *   - Apply rate limiting (3/s anonymous, 10/s with API key)
 *   - Retry on HTTP 429 with exponential backoff
 *   - Parse XML and JSON responses
 *
 * The main entry point for command authors is `createHttpContext()`,
 * which returns an HttpContext object ready for use.
 */

import { getApiKey, getEmail } from './config.js';
import { getRateLimiter } from './rate-limiter.js';
import { parseXml } from './xml-parser.js';
import { RateLimitError, ApiError } from './errors.js';
import { sleep } from './utils.js';
import type { HttpContext, NcbiFetchOptions } from './types.js';

// ── Constants ────────────────────────────────────────────────────────────────

export const EUTILS_BASE = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils';

/** Maximum number of retries on HTTP 429 responses. */
const MAX_RETRIES = 3;

/** Base delay in ms for exponential backoff (doubled on each retry). */
const BASE_RETRY_DELAY_MS = 500;

/** Tool parameter sent to NCBI to identify this client. */
const TOOL_NAME = 'ncbicli';

// ── URL builder ──────────────────────────────────────────────────────────────

/**
 * Build a full E-utilities URL for a given tool endpoint.
 *
 * @param tool    E-utilities tool name (e.g. 'esearch.fcgi', 'efetch.fcgi')
 * @param params  Query parameters to include
 * @returns       Fully-formed URL string
 *
 * @example
 * ```ts
 * const url = buildEutilsUrl('esearch.fcgi', { db: 'pubmed', term: 'cancer' });
 * // https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed&term=cancer
 * ```
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
 *
 * Most command authors should use `createHttpContext()` instead, which
 * provides higher-level `fetchXml` and `fetchJson` wrappers.
 */
export async function ncbiFetch(
  url: string,
  opts?: NcbiFetchOptions,
  apiKey?: string,
  email?: string,
): Promise<Response> {
  // Build the final URL with merged params
  const parsed = new URL(url);

  // Inject params from opts
  if (opts?.params) {
    for (const [k, v] of Object.entries(opts.params)) {
      if (v !== undefined && v !== '') parsed.searchParams.set(k, v);
    }
  }

  // Inject api_key, email, and tool identification
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

  // Acquire rate limiter token (unless explicitly skipped)
  if (!opts?.skipRateLimit) {
    const limiter = getRateLimiter(!!apiKey);
    await limiter.acquire();
  }

  // Fetch with retry on 429
  let lastError: Error | undefined;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await fetch(finalUrl, {
        method: opts?.method ?? 'GET',
        headers: opts?.headers,
        body: opts?.body,
      });

      if (response.status === 429) {
        // Rate limited by NCBI
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
 * Create an HttpContext for command execution.
 *
 * The returned context has NCBI credentials, rate limiting, and retry
 * logic baked in. Pass it to any command's `func()`.
 */
export function createHttpContext(): HttpContext {
  const apiKey = getApiKey();
  const email = getEmail();

  // Ensure the rate limiter is initialized with the correct rate
  getRateLimiter(!!apiKey);

  return {
    apiKey,
    email,

    async fetch(url: string, opts?: NcbiFetchOptions): Promise<Response> {
      return ncbiFetch(url, opts, apiKey, email);
    },

    async fetchXml(url: string, opts?: NcbiFetchOptions): Promise<unknown> {
      const response = await ncbiFetch(url, opts, apiKey, email);
      const text = await response.text();
      return parseXml(text);
    },

    async fetchJson(url: string, opts?: NcbiFetchOptions): Promise<unknown> {
      const response = await ncbiFetch(url, opts, apiKey, email);
      return response.json();
    },
  };
}
