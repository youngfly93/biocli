/**
 * Sliding-window rate limiter for biocli database backends.
 *
 * Each database has its own rate limit:
 *   - NCBI:    3/s (anonymous), 10/s (with API key)
 *   - UniProt: 50/s
 *   - KEGG:    10/s
 *   - STRING:  1/s
 *   - Ensembl: 15/s
 *   - Enrichr: 5/s
 *
 * Singletons are maintained via globalThis so that all code paths
 * share the same limiter instances (including across npm-linked plugins).
 */

import { sleep } from './utils.js';

// ── RateLimiter class ────────────────────────────────────────────────────────

export class RateLimiter {
  /** Timestamps (ms) of requests within the current 1-second window. */
  private timestamps: number[] = [];
  /** Queued resolve callbacks waiting for a slot. */
  private queue: Array<() => void> = [];
  /** Whether a drain loop is already scheduled. */
  private draining = false;

  constructor(private maxPerSecond: number) {}

  /**
   * Wait until a request slot is available, then record the timestamp.
   * Callers should `await limiter.acquire()` before each HTTP request.
   */
  async acquire(): Promise<void> {
    this.pruneOldTimestamps();

    if (this.timestamps.length < this.maxPerSecond) {
      // Slot available immediately
      this.timestamps.push(Date.now());
      return;
    }

    // No slot available — enqueue and wait
    return new Promise<void>((resolve) => {
      this.queue.push(resolve);
      this.scheduleDrain();
    });
  }

  /** Update the rate limit (e.g. when an API key is added mid-session). */
  setRate(maxPerSecond: number): void {
    this.maxPerSecond = maxPerSecond;
  }

  // ── Internal helpers ────────────────────────────────────────────────────

  /** Remove timestamps older than 1 second from the window. */
  private pruneOldTimestamps(): void {
    const cutoff = Date.now() - 1000;
    while (this.timestamps.length > 0 && this.timestamps[0] <= cutoff) {
      this.timestamps.shift();
    }
  }

  /** Start a drain loop that services the queue as slots open up. */
  private scheduleDrain(): void {
    if (this.draining) return;
    this.draining = true;

    const drain = async (): Promise<void> => {
      while (this.queue.length > 0) {
        this.pruneOldTimestamps();

        if (this.timestamps.length < this.maxPerSecond) {
          // A slot opened up — release the next waiter
          this.timestamps.push(Date.now());
          const next = this.queue.shift();
          if (next) next();
        } else {
          // Calculate how long until the oldest timestamp expires
          const oldest = this.timestamps[0];
          const waitMs = Math.max(1, (oldest + 1000) - Date.now() + 1);
          await sleep(waitMs);
        }
      }
      this.draining = false;
    };

    // Fire-and-forget — errors here are programming bugs, not user-facing
    drain().catch(() => { this.draining = false; });
  }
}

// ── Per-database limiter registry ────────────────────────────────────────────

declare global {
  // eslint-disable-next-line no-var
  var __biocli_rate_limiters__: Map<string, RateLimiter> | undefined;
  // Legacy NCBI singleton (backward compat)
  // eslint-disable-next-line no-var
  var __ncbicli_rate_limiter__: RateLimiter | undefined;
  // eslint-disable-next-line no-var
  var __ncbicli_rate_limiter_has_key__: boolean | undefined;
}

const _limiters: Map<string, RateLimiter> =
  globalThis.__biocli_rate_limiters__ ??= new Map();

/**
 * Get (or create) a rate limiter for a specific database.
 *
 * Each database gets its own independent limiter instance keyed by ID.
 */
export function getRateLimiterForDatabase(databaseId: string, maxPerSecond: number): RateLimiter {
  let limiter = _limiters.get(databaseId);
  if (!limiter) {
    limiter = new RateLimiter(maxPerSecond);
    _limiters.set(databaseId, limiter);
  }
  return limiter;
}

/**
 * Get (or create) the NCBI rate limiter.
 *
 * @deprecated Use getRateLimiterForDatabase('ncbi', rate) instead.
 *             Kept for backward compatibility with existing NCBI adapters.
 *
 * @param hasApiKey  Whether the user has an NCBI API key configured.
 *                   This determines the rate: 10/s with key, 3/s without.
 */
export function getRateLimiter(hasApiKey: boolean): RateLimiter {
  const rate = hasApiKey ? 10 : 3;

  // Delegate to the per-database registry
  const limiter = getRateLimiterForDatabase('ncbi', rate);

  // If the API key status changed, update the rate
  if (globalThis.__ncbicli_rate_limiter_has_key__ !== hasApiKey) {
    limiter.setRate(rate);
    globalThis.__ncbicli_rate_limiter_has_key__ = hasApiKey;
  }

  // Keep legacy global reference in sync
  globalThis.__ncbicli_rate_limiter__ = limiter;

  return limiter;
}
