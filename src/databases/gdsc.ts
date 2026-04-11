/**
 * GDSC backend for biocli.
 *
 * GDSC is distributed as bulk release files rather than a query API.
 * This backend exists so workflow code can obtain a dedicated HttpContext
 * for official download URLs without falling back to another database.
 */

import { getRateLimiterForDatabase } from '../rate-limiter.js';
import { ApiError } from '../errors.js';
import { sleep } from '../utils.js';
import { fetchWithIPv4Fallback } from '../http-dispatcher.js';
import type { FetchOptions, HttpContext } from '../types.js';
import { type DatabaseBackend, registerBackend } from './index.js';

export const GDSC_BASE_URL =
  process.env.BIOCLI_GDSC_BASE_URL ?? 'https://cog.sanger.ac.uk/cancerrxgene/GDSC_release8.5';

const RATE_LIMIT_RPS = 1;
const MAX_RETRIES = 2;
const BASE_RETRY_DELAY_MS = 1000;
const RETRYABLE_STATUS_CODES = new Set([429, 500, 502, 503, 504]);

function buildGdscHint(): string {
  return 'Run biocli gdsc refresh to re-download the official bulk files and rebuild the local index, then retry the command that depends on GDSC.';
}

async function gdscFetch(url: string, opts?: FetchOptions): Promise<Response> {
  const finalUrl = url;

  if (!opts?.skipRateLimit) {
    const limiter = getRateLimiterForDatabase('gdsc', RATE_LIMIT_RPS);
    await limiter.acquire();
  }

  let lastError: Error | undefined;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await fetchWithIPv4Fallback(finalUrl, {
        method: opts?.method ?? 'GET',
        headers: {
          'Accept': '*/*',
          ...opts?.headers,
        },
        body: opts?.body,
      });

      if (RETRYABLE_STATUS_CODES.has(response.status)) {
        if (attempt < MAX_RETRIES) {
          try { await response.arrayBuffer(); } catch { /* ignore */ }
          await sleep(BASE_RETRY_DELAY_MS * Math.pow(2, attempt));
          continue;
        }
        throw new ApiError(
          `GDSC returned HTTP ${response.status} after ${MAX_RETRIES + 1} attempts`,
          buildGdscHint(),
        );
      }

      if (!response.ok) {
        throw new ApiError(
          `GDSC returned HTTP ${response.status}: ${response.statusText}`,
          buildGdscHint(),
        );
      }

      return response;
    } catch (error) {
      if (error instanceof ApiError) throw error;
      lastError = error instanceof Error ? error : new Error(String(error));
      if (attempt < MAX_RETRIES) {
        await sleep(BASE_RETRY_DELAY_MS * Math.pow(2, attempt));
        continue;
      }
    }
  }

  throw new ApiError(
    `GDSC request failed after ${MAX_RETRIES + 1} attempts: ${lastError?.message ?? 'unknown error'}`,
    buildGdscHint(),
  );
}

function createContext(): HttpContext {
  return {
    databaseId: 'gdsc',

    async fetch(url: string, opts?: FetchOptions): Promise<Response> {
      return gdscFetch(url, opts);
    },

    async fetchJson(url: string, opts?: FetchOptions): Promise<unknown> {
      const response = await gdscFetch(url, opts);
      return response.json();
    },

    async fetchXml(url: string, opts?: FetchOptions): Promise<unknown> {
      const response = await gdscFetch(url, opts);
      return response.text();
    },

    async fetchText(url: string, opts?: FetchOptions): Promise<string> {
      const response = await gdscFetch(url, opts);
      return response.text();
    },
  };
}

export const gdscBackend: DatabaseBackend = {
  id: 'gdsc',
  name: 'GDSC',
  baseUrl: GDSC_BASE_URL,
  rateLimit: RATE_LIMIT_RPS,
  createContext,
};

registerBackend(gdscBackend);
