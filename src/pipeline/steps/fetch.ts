/**
 * Pipeline step: fetch — HTTP API requests for NCBI endpoints.
 *
 * Adapted from opencli:
 * - No browser-related fetch paths (no page.evaluate, no fetchBatchInBrowser)
 * - Always uses Node.js built-in fetch()
 * - Automatic API key / email injection via HttpContext
 * - Rate limiting integration via HttpContext.fetch() or standalone rate limiter
 * - XML auto-detection: if Content-Type contains 'xml', auto-parse with parseXml()
 * - Per-item fetch pattern (when data is array and URL contains `item`)
 * - Configurable concurrency (default 5)
 */

import { CliError, getErrorMessage } from '../../errors.js';
import type { HttpContext } from '../../types.js';
import { renderTemplate } from '../template.js';
import { isRecord, mapConcurrent } from '../../utils.js';

/**
 * Check if a Content-Type header indicates XML.
 */
function isXmlContentType(contentType: string | null): boolean {
  if (!contentType) return false;
  return contentType.includes('xml');
}

/**
 * Parse an XML string into a JS object using fast-xml-parser.
 * Lazily imports to avoid top-level dependency issues.
 */
async function parseXmlResponse(text: string): Promise<unknown> {
  const { XMLParser } = await import('fast-xml-parser');
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    textNodeName: '#text',
    isArray: (_name: string, _jpath: string, isLeafNode: boolean, isAttribute: boolean) => {
      // Keep leaf text nodes as scalars; arrays only for repeated elements
      if (isAttribute || isLeafNode) return false;
      return false;
    },
  });
  return parser.parse(text);
}

/**
 * Build a URL with query parameters appended.
 */
function appendQueryParams(url: string, params: Record<string, string>): string {
  if (Object.keys(params).length === 0) return url;
  const qs = new URLSearchParams(params).toString();
  return `${url}${url.includes('?') ? '&' : '?'}${qs}`;
}

/**
 * Inject NCBI API key and email into query params if available on the context.
 */
function injectNcbiParams(
  params: Record<string, string>,
  ctx: HttpContext | null,
): Record<string, string> {
  const result = { ...params };
  if (ctx?.apiKey && !result.api_key) {
    result.api_key = ctx.apiKey;
  }
  if (ctx?.email && !result.email) {
    result.email = ctx.email;
  }
  return result;
}

/**
 * Perform a single HTTP fetch with optional rate limiting via HttpContext.
 * Auto-detects XML responses and parses them.
 */
async function fetchSingle(
  ctx: HttpContext | null,
  url: string,
  method: string,
  queryParams: Record<string, string>,
  headers: Record<string, string>,
): Promise<unknown> {
  // Inject NCBI credentials
  const mergedParams = injectNcbiParams(queryParams, ctx);
  const finalUrl = appendQueryParams(url, mergedParams);

  let resp: Response;

  if (ctx) {
    // Use context's rate-limited fetch
    resp = await ctx.fetch(finalUrl, {
      method: method.toUpperCase(),
      headers,
    });
  } else {
    // Direct fetch (no rate limiting)
    resp = await fetch(finalUrl, {
      method: method.toUpperCase(),
      headers,
    });
  }

  if (!resp.ok) {
    throw new CliError(
      'FETCH_ERROR',
      `HTTP ${resp.status} ${resp.statusText} from ${finalUrl}`,
    );
  }

  // Auto-detect XML and parse accordingly
  const contentType = resp.headers.get('content-type');
  const text = await resp.text();

  if (isXmlContentType(contentType)) {
    return parseXmlResponse(text);
  }

  // Try JSON
  try {
    return JSON.parse(text);
  } catch {
    // Return raw text if not parseable as JSON
    return text;
  }
}

/**
 * Pipeline fetch step handler.
 *
 * Params can be:
 * - A string (URL template)
 * - An object with: url, method, params, headers, concurrency
 */
export async function handleFetch(
  ctx: HttpContext | null,
  params: unknown,
  data: unknown,
  args: Record<string, unknown>,
): Promise<unknown> {
  const paramObject = isRecord(params) ? params : {};
  const urlOrObj = typeof params === 'string' ? params : (paramObject.url ?? '');
  const method =
    typeof paramObject.method === 'string' ? paramObject.method : 'GET';
  const queryParams = isRecord(paramObject.params)
    ? paramObject.params
    : {};
  const headers = isRecord(paramObject.headers)
    ? paramObject.headers
    : {};
  const urlTemplate = String(urlOrObj);

  // Per-item fetch when data is array and URL references item
  if (Array.isArray(data) && urlTemplate.includes('item')) {
    const concurrency =
      typeof paramObject.concurrency === 'number' ? paramObject.concurrency : 5;

    // Render headers and query params once (they don't depend on item)
    const renderedHeaders: Record<string, string> = {};
    for (const [k, v] of Object.entries(headers)) {
      renderedHeaders[k] = String(renderTemplate(v, { args, data }));
    }
    const renderedQueryParams: Record<string, string> = {};
    for (const [k, v] of Object.entries(queryParams)) {
      renderedQueryParams[k] = String(renderTemplate(v, { args, data }));
    }

    // Fetch each item concurrently with bounded concurrency
    return mapConcurrent(data, async (item, index) => {
      const itemUrl = String(
        renderTemplate(urlTemplate, { args, data, item, index }),
      );
      try {
        return await fetchSingle(
          ctx,
          itemUrl,
          method,
          renderedQueryParams,
          renderedHeaders,
        );
      } catch (error) {
        const message = getErrorMessage(error);
        return { error: message };
      }
    }, concurrency);
  }

  // Single fetch
  const url = String(renderTemplate(urlOrObj, { args, data }));

  // Render query params and headers with current context
  const renderedQueryParams: Record<string, string> = {};
  for (const [k, v] of Object.entries(queryParams)) {
    renderedQueryParams[k] = String(renderTemplate(v, { args, data }));
  }
  const renderedHeaders: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    renderedHeaders[k] = String(renderTemplate(v, { args, data }));
  }

  return fetchSingle(ctx, url, method, renderedQueryParams, renderedHeaders);
}
