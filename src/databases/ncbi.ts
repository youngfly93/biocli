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
import { ApiError } from '../errors.js';
import { fetchWithIPv4Fallback } from '../http-dispatcher.js';
import { buildRetryableApiError, buildRetryableRateLimitError, executeHttpRequestWithRetry } from '../retry-policy.js';
import type { HttpContext, FetchOptions } from '../types.js';
import { type DatabaseBackend, registerBackend } from './index.js';

// ── Constants ────────────────────────────────────────────────────────────────

export const EUTILS_BASE = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils';

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

function buildNcbiHint(finalUrl: string): string {
  const url = new URL(finalUrl);
  const tool = url.pathname.split('/').pop()?.toLowerCase() ?? '';
  const db = url.searchParams.get('db')?.toLowerCase() ?? '';

  if (db === 'pubmed') {
    if (tool === 'esearch.fcgi') return 'Retry with biocli pubmed search <query> -f json after simplifying the PubMed query.';
    return 'Run biocli pubmed search <query> -f json to find valid PMIDs, then retry with biocli pubmed fetch <pmid> or another PubMed command.';
  }
  if (db === 'gene') {
    if (tool === 'esearch.fcgi') return 'Retry with biocli gene search <symbol> -f json using a canonical gene symbol like TP53.';
    if (tool === 'esummary.fcgi') return 'Run biocli gene search <symbol> -f json to find a valid Gene ID, then retry with biocli gene info <geneId>.';
    return 'Run biocli gene search <symbol> -f json to find a valid Gene ID before fetching linked records.';
  }
  if (db === 'gds') {
    if (tool === 'esearch.fcgi') return 'Retry with biocli geo search <query> -f json to find a valid GEO series or dataset.';
    return 'Run biocli geo search <query> -f json to find a valid GEO accession, then retry with biocli geo dataset <gse> or biocli geo samples <gse>.';
  }
  if (db === 'sra') {
    if (tool === 'esearch.fcgi') return 'Retry with biocli sra search <query> -f json to find a valid study or run accession.';
    return 'Run biocli sra search <query> -f json to find a valid accession, then retry with biocli sra run <run> or related SRA commands.';
  }
  if (db === 'taxonomy') {
    return 'Retry with biocli taxonomy lookup <name-or-taxid> -f json using a canonical taxon name or numeric taxid.';
  }
  if (db === 'clinvar') {
    if (tool === 'esearch.fcgi') return 'Retry with biocli clinvar search <query> -f json to find a valid ClinVar record.';
    return 'Run biocli clinvar search <query> -f json to find a valid ClinVar ID, then retry with biocli clinvar variant <id>.';
  }
  if (db === 'snp') {
    return 'Retry with biocli snp lookup rs123 -f json using a valid rsID.';
  }
  return 'Check the identifier or search query, then retry the matching biocli command with -f json.';
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

  return executeHttpRequestWithRetry({
    backendId: 'ncbi',
    execute: () => fetchWithIPv4Fallback(finalUrl, {
        method: opts?.method ?? 'GET',
        headers: opts?.headers,
        body: opts?.body,
      }),
    onRetryableStatusExhausted: (_status, attempts) => buildRetryableRateLimitError(
      `NCBI returned 429 after ${attempts} attempts`,
      'Add an NCBI API key (biocli config set api_key YOUR_KEY) to increase the rate limit from 3 to 10 req/s',
    ),
    onNonRetryableStatus: (response) => new ApiError(
      `NCBI API returned HTTP ${response.status}: ${response.statusText}`,
      buildNcbiHint(finalUrl),
    ),
    onNetworkErrorExhausted: (error, attempts) => buildRetryableApiError(
      `NCBI request failed after ${attempts} attempts: ${error.message}`,
      'Check NCBI API status at https://www.ncbi.nlm.nih.gov/home/develop/',
    ),
  });
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
