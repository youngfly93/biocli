/**
 * Core type definitions for biocli.
 *
 * HttpContext is the primary execution context passed to every command
 * function. It wraps database-aware HTTP fetching with built-in rate
 * limiting, authentication injection, and response parsing.
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

// ── Fetch options ─────────────────────────────────────────────────────────────

/** Options for a single HTTP request. Generic across all database backends. */
export interface FetchOptions {
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
 * @deprecated Use FetchOptions instead. Kept for backward compatibility
 * with existing NCBI adapters.
 */
export type NcbiFetchOptions = FetchOptions;

// ── HTTP context ──────────────────────────────────────────────────────────────

/**
 * HTTP execution context provided to every command function.
 *
 * Each database backend creates its own HttpContext with the appropriate
 * rate limiter, authentication, and response parsers baked in.
 */
export interface HttpContext {
  /** Database backend ID this context is bound to (e.g. 'ncbi', 'uniprot'). */
  databaseId: string;
  /** Make an HTTP request and return the raw Response. */
  fetch(url: string, opts?: FetchOptions): Promise<Response>;
  /** Fetch a URL and parse the response body as XML, returning the parsed object. */
  fetchXml(url: string, opts?: FetchOptions): Promise<unknown>;
  /** Fetch a URL and parse the response body as JSON. */
  fetchJson(url: string, opts?: FetchOptions): Promise<unknown>;
  /** Fetch a URL and return the raw text body. */
  fetchText(url: string, opts?: FetchOptions): Promise<string>;
  /** Database-specific credentials (NCBI: api_key, email; etc.). */
  credentials?: Record<string, string>;

  // ── NCBI backward-compat aliases ──
  /** @deprecated Use credentials?.api_key instead. */
  apiKey?: string;
  /** @deprecated Use credentials?.email instead. */
  email?: string;
}
