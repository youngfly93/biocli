/**
 * Core type definitions for ncbicli.
 *
 * HttpContext replaces opencli's IPage as the primary execution context
 * passed to every command function. It wraps NCBI-aware HTTP fetching
 * with built-in rate limiting, API key injection, and XML/JSON parsing.
 */

// ── Result metadata ────────────────────────────────────────────────────────────

/** Metadata that commands can attach to results for the rendering layer. */
export interface ResultMeta {
  /** Total matching items from the API (e.g. esearch count), for "3 of N" display. */
  totalCount?: number;
  /** The original search query, used for keyword highlighting. */
  query?: string;
}

/**
 * Wraps a result array with optional display metadata.
 *
 * Commands return this via `withMeta(rows, meta)` — the commander-adapter
 * extracts the meta and passes it to the output renderer.
 */
export interface ResultWithMeta<T = unknown> {
  readonly __resultMeta: true;
  rows: T[];
  meta: ResultMeta;
}

/** Wrap command results with display metadata. */
export function withMeta<T>(rows: T[], meta: ResultMeta): ResultWithMeta<T> {
  return { __resultMeta: true as const, rows, meta };
}

/** Type guard for ResultWithMeta. */
export function hasResultMeta(v: unknown): v is ResultWithMeta {
  return typeof v === 'object' && v !== null && (v as ResultWithMeta).__resultMeta === true;
}

/** Options for a single NCBI HTTP request. */
export interface NcbiFetchOptions {
  /** HTTP method (defaults to 'GET'). */
  method?: string;
  /** Additional HTTP headers. */
  headers?: Record<string, string>;
  /** URL query parameters (merged with any already in the URL). */
  params?: Record<string, string>;
  /** Request body (for POST requests). */
  body?: string;
  /** If true, skip the rate limiter for this request. */
  skipRateLimit?: boolean;
}

/**
 * HTTP execution context provided to every command function.
 *
 * This is the ncbicli equivalent of opencli's IPage — instead of browser
 * automation, commands get an HTTP client pre-configured with NCBI
 * credentials, rate limiting, and retry logic.
 */
export interface HttpContext {
  /** Make an HTTP request and return the raw Response. */
  fetch(url: string, opts?: NcbiFetchOptions): Promise<Response>;
  /** Fetch a URL and parse the response body as XML, returning the parsed object. */
  fetchXml(url: string, opts?: NcbiFetchOptions): Promise<unknown>;
  /** Fetch a URL and parse the response body as JSON. */
  fetchJson(url: string, opts?: NcbiFetchOptions): Promise<unknown>;
  /** NCBI API key, if configured. */
  apiKey?: string;
  /** Contact email, if configured. */
  email?: string;
}
