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

import { Agent, setGlobalDispatcher, fetch as undiciFetch } from 'undici';
import { lookup } from 'node:dns';

// CRITICAL: On Node 18+, the global `fetch` uses Node's *bundled* undici,
// not the one we install via `npm install undici`. setGlobalDispatcher() on
// our undici instance has NO effect on global fetch(). To use a custom
// dispatcher, callers MUST use `undiciFetch` (re-exported below) instead
// of the global `fetch`.

// Default Agent: Happy Eyeballs (try v4/v6 in parallel)
// Used by fetchWithIPv4Fallback as the "fast path" attempt.
//
// CRITICAL: connectTimeout is short (5s) so that hung loser sockets
// (e.g. WSL2 v6 connection that won't RST) are torn down quickly even
// if AbortSignal can't reach the underlying net.connect attempt. Without
// this, the event loop stays alive for 15s after the user script ends.
export const defaultAgent = new Agent({
  connect: {
    autoSelectFamily: true,
    autoSelectFamilyAttemptTimeout: 250,
    timeout: 5_000,
  },
  connectTimeout: 5_000,
  headersTimeout: 30_000,
  bodyTimeout: 60_000,
});

// Side-effect: also install as global dispatcher. This is mostly cosmetic
// because Node 18+ global fetch() uses bundled undici, not our installed
// undici, so setGlobalDispatcher() doesn't affect global fetch(). But it
// helps any code that DOES use undiciFetch without an explicit dispatcher.
setGlobalDispatcher(defaultAgent);

// IPv4-only Agent for explicit fallback when default dispatcher fails
// (e.g. WSL2 with soft-failing IPv6 where autoSelectFamily can't decide).
//
// CRITICAL: undici's `connect.family: 4` is not enough on its own. undici
// resolves DNS itself (default family=0, returns A + AAAA), then hands the
// address list to net.connect. With autoSelectFamily=true (Node default),
// net.connect will still try v6 in parallel even when family:4 is set.
//
// To truly force IPv4 we must:
//   1. Override the DNS lookup to filter at the resolver layer (only A records)
//   2. Set autoSelectFamily: false to prevent net.connect from re-racing v6
export const ipv4Agent = new Agent({
  connect: {
    // Force DNS to only return A records — bypass dual-stack resolution
    lookup: (hostname, options, cb) =>
      lookup(hostname, { ...options, family: 4 }, cb),
    // Disable Happy Eyeballs so net.connect can't pull v6 back in
    autoSelectFamily: false,
    timeout: 10_000,
  },
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
  // MUST use undiciFetch with explicit dispatcher because Node's global
  // fetch() uses bundled undici and ignores setGlobalDispatcher() on the
  // npm-installed undici instance.
  const ac1 = makeChildController();
  const init1 = { ...init, signal: ac1.signal, dispatcher: defaultAgent };
  const defaultAttempt = undiciFetch(url, init1 as Parameters<typeof undiciFetch>[1]) as unknown as Promise<Response>;
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
    return await undiciFetch(url, { ...init, signal: ac2.signal, dispatcher: ipv4Agent } as Parameters<typeof undiciFetch>[1]) as unknown as Response;
  }

  // earlyOutcome === 'timeout' — default still in flight, start IPv4 in parallel
  if (process.env.BIOCLI_DEBUG_HTTP) {
    console.error(`[biocli] default fetch slow (>${RACE_DELAY_MS}ms), racing IPv4 fallback in parallel`);
  }

  const ac2 = makeChildController();
  const ipv4Attempt = undiciFetch(url, { ...init, signal: ac2.signal, dispatcher: ipv4Agent } as Parameters<typeof undiciFetch>[1]) as unknown as Promise<Response>;
  ipv4Attempt.catch(() => {});

  try {
    // Tag each attempt so we know which one won, then ONLY abort the loser.
    //
    // Bug history:
    //   v0.3.6: aborted both → killed winner's body stream → AbortError on read
    //   v0.3.7: aborted only loser, but loser's hung v6 socket kept the event
    //           loop alive for 15s (the old connectTimeout) → "command takes 15s
    //           to exit even though data returned in 3s"
    //   v0.3.8: lowered defaultAgent connectTimeout to 5s so hung v6 sockets
    //           get killed quickly even if AbortSignal can't reach them
    const winner = await Promise.any([
      defaultAttempt.then((r) => ({ tag: 'default' as const, r })),
      ipv4Attempt.then((r) => ({ tag: 'ipv4' as const, r })),
    ]);
    if (winner.tag === 'default') {
      ac2.abort(); // loser = ipv4
    } else {
      ac1.abort(); // loser = default; underlying v6 socket killed by 5s connectTimeout
    }
    return winner.r;
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
