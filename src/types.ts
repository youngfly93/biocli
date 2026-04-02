/**
 * Core type definitions for ncbicli.
 *
 * HttpContext replaces opencli's IPage as the primary execution context
 * passed to every command function. It wraps NCBI-aware HTTP fetching
 * with built-in rate limiting, API key injection, and XML/JSON parsing.
 */

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
