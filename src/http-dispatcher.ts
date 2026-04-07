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

// Window after which we start the IPv4 fallback in parallel rather than
// waiting for the default attempt to fail. WSL2 / soft-failing IPv6 networks
// often hold the v6 SYN open for tens of seconds; without this race the user
// experiences 30-50s hangs even though IPv4 would resolve in < 1s.
const RACE_DELAY_MS = 2_500;

/**
 * Fetch with parallel IPv4 fallback.
 *
 * Strategy:
 *   1. Start the default fetch (with autoSelectFamily Happy Eyeballs)
 *   2. Wait up to RACE_DELAY_MS for it to succeed or fail
 *   3. If it succeeds → return it (zero overhead in the common case)
 *   4. If it fails fast → retry with IPv4-only agent
 *   5. If it neither succeeds nor fails → start IPv4 attempt IN PARALLEL
 *      and return whichever resolves first
 *
 * Each attempt uses its own AbortController bridged to the user's signal,
 * so the user can still cancel cleanly without one attempt killing the other.
 *
 * Fixes #1 (WSL2 NCBI hangs).
 */
export async function fetchWithIPv4Fallback(
  url: string,
  init: RequestInit & { signal?: AbortSignal } = {},
): Promise<Response> {
  const userSignal = init.signal;

  // Bridge the user's signal to a child controller so cancelling one
  // attempt doesn't cancel the other (Bug B in v0.3.4)
  function makeChildController(): AbortController {
    const ac = new AbortController();
    if (userSignal) {
      if (userSignal.aborted) {
        ac.abort();
      } else {
        userSignal.addEventListener('abort', () => ac.abort(), { once: true });
      }
    }
    return ac;
  }

  // ── Attempt 1: default dispatcher (autoSelectFamily) ────────────────────
  const ac1 = makeChildController();
  const init1: RequestInit = { ...init, signal: ac1.signal };
  // Strip any pre-existing dispatcher option
  delete (init1 as Record<string, unknown>).dispatcher;
  const defaultAttempt = fetch(url, init1);
  // Suppress unhandled-rejection if we end up abandoning this attempt
  defaultAttempt.catch(() => {});

  // ── Race: give the default attempt RACE_DELAY_MS to win or lose ────────
  let raceTimer: NodeJS.Timeout | undefined;
  const earlyOutcome = await Promise.race<'success' | 'error' | 'timeout'>([
    defaultAttempt.then(
      () => 'success' as const,
      () => 'error' as const,
    ),
    new Promise<'timeout'>((resolve) => {
      raceTimer = setTimeout(() => resolve('timeout'), RACE_DELAY_MS);
    }),
  ]);
  if (raceTimer) clearTimeout(raceTimer);

  if (earlyOutcome === 'success') {
    return await defaultAttempt;
  }

  if (earlyOutcome === 'error') {
    // Default failed fast — check if it's a recoverable connect error
    const err = await defaultAttempt.catch((e: unknown) => e);
    const cause = (err as Error & { cause?: { code?: string } }).cause;
    const code = cause?.code;
    const errName = (err as Error).name;
    const isConnectError = code === 'UND_ERR_CONNECT_TIMEOUT'
      || code === 'ECONNREFUSED'
      || code === 'ECONNRESET'
      || code === 'ENETUNREACH'
      || errName === 'AbortError'
      || errName === 'TypeError'; // undici wraps connect failures as TypeError

    if (!isConnectError) {
      throw err;
    }

    if (process.env.BIOCLI_DEBUG_HTTP) {
      console.error(`[biocli] default fetch failed fast (${code ?? errName}), falling back to IPv4-only`);
    }

    // Fast fallback path
    const ac2 = makeChildController();
    return await fetch(url, { ...init, signal: ac2.signal, dispatcher: ipv4Agent } as RequestInit);
  }

  // earlyOutcome === 'timeout' — default still in flight, start IPv4 in parallel
  if (process.env.BIOCLI_DEBUG_HTTP) {
    console.error(`[biocli] default fetch slow (>${RACE_DELAY_MS}ms), racing IPv4 fallback in parallel`);
  }

  const ac2 = makeChildController();
  const ipv4Attempt = fetch(url, { ...init, signal: ac2.signal, dispatcher: ipv4Agent } as RequestInit);
  ipv4Attempt.catch(() => {});

  try {
    const winner = await Promise.any([defaultAttempt, ipv4Attempt]);
    // Cancel the loser to free its socket
    ac1.abort();
    ac2.abort();
    return winner;
  } catch (aggregateErr) {
    if (aggregateErr instanceof AggregateError && aggregateErr.errors.length > 0) {
      throw aggregateErr.errors[0];
    }
    throw aggregateErr;
  }
}

// Exported marker so other modules can confirm the dispatcher was installed
export const dispatcherInstalled = true;

if (process.env.BIOCLI_VERBOSE || process.env.BIOCLI_DEBUG_HTTP) {
  console.error('[biocli] undici dispatcher installed (autoSelectFamily=true, attemptTimeout=250ms, IPv4 fallback enabled)');
}
