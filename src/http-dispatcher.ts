/**
 * Global undici dispatcher with proper Happy Eyeballs.
 *
 * Fixes https://github.com/youngfly93/biocli/issues/1
 *
 * Default Node fetch (undici) doesn't reliably fall back from a soft-failing
 * IPv6 path to IPv4. This is common on:
 *   - WSL2 (IPv6 SYN hangs ~8s before reset)
 *   - Some corporate networks with broken v6 egress
 *   - Some CI runners
 *
 * NCBI is the only biocli backend that publishes an AAAA record, so all
 * NCBI commands hang on these networks while other backends work fine.
 *
 * This module installs a global dispatcher that:
 *   1. Enables autoSelectFamily explicitly with a 250ms attempt timeout
 *   2. Uses generous connect/headers/body timeouts (NCBI first packet can be 3-4s)
 *   3. Enables retry on transient failures
 */

import { Agent, setGlobalDispatcher } from 'undici';

// Side-effect: install dispatcher at module-load time.
// This module MUST be the first import in main.ts so it runs before any
// other module that might call fetch() at top level.
setGlobalDispatcher(new Agent({
  connect: {
    // Happy Eyeballs: try IPv4/IPv6 in parallel, prefer whichever responds first
    autoSelectFamily: true,
    autoSelectFamilyAttemptTimeout: 250,
    // Per-attempt connect timeout (TCP + TLS handshake)
    timeout: 15_000,
  },
  // Total time to establish connection across all family attempts
  connectTimeout: 15_000,
  // Time to wait for response headers after request sent
  headersTimeout: 30_000,
  // Time to wait for response body to finish streaming
  bodyTimeout: 60_000,
}));

// IPv4-only Agent for explicit fallback when default dispatcher fails
// (e.g. WSL2 with soft-failing IPv6 where autoSelectFamily can't decide)
export const ipv4Agent = new Agent({
  connect: { family: 4, timeout: 10_000 },
  connectTimeout: 10_000,
  headersTimeout: 20_000,
  bodyTimeout: 30_000,
});

/**
 * Fetch with automatic IPv4 fallback on connect failure.
 *
 * Tries the default dispatcher first (which has autoSelectFamily). If that
 * fails or times out, retries once with the IPv4-only agent. This guarantees
 * forward progress on networks where IPv6 is soft-broken (WSL2, some VPNs).
 */
export async function fetchWithIPv4Fallback(
  url: string,
  init: RequestInit & { signal?: AbortSignal } = {},
): Promise<Response> {
  try {
    return await fetch(url, init);
  } catch (err) {
    // Retry with explicit IPv4 agent on connect failures
    const cause = (err as Error & { cause?: { code?: string } }).cause;
    const code = cause?.code;
    const isConnectError = code === 'UND_ERR_CONNECT_TIMEOUT'
      || code === 'ECONNREFUSED'
      || code === 'ECONNRESET'
      || code === 'ENETUNREACH'
      || (err as Error).name === 'AbortError';

    if (!isConnectError) throw err;

    if (process.env.BIOCLI_DEBUG_HTTP) {
      console.error(`[biocli] fetch failed with ${code ?? (err as Error).name}, retrying with IPv4-only`);
    }

    // Force IPv4 retry — undici-specific dispatcher option
    return await fetch(url, { ...init, dispatcher: ipv4Agent } as RequestInit);
  }
}

// Exported marker so other modules can confirm the dispatcher was installed
export const dispatcherInstalled = true;

if (process.env.BIOCLI_VERBOSE || process.env.BIOCLI_DEBUG_HTTP) {
  console.error('[biocli] undici dispatcher installed (autoSelectFamily=true, attemptTimeout=250ms, IPv4 fallback enabled)');
}
