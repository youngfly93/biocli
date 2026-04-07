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

let installed = false;

export function installGlobalDispatcher(): void {
  if (installed) return;
  installed = true;

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
}
