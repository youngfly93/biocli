/**
 * Token-bucket rate limiter for NCBI E-utilities.
 *
 * NCBI enforces rate limits:
 *   - Without API key: 3 requests per second
 *   - With API key:   10 requests per second
 *
 * This module uses a sliding-window approach: it tracks timestamps of
 * recent requests and delays new ones when the window is full.
 * A singleton is maintained via globalThis so that all code paths
 * share the same limiter instance.
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

// ── Singleton management ─────────────────────────────────────────────────────

declare global {
  // eslint-disable-next-line no-var
  var __ncbicli_rate_limiter__: RateLimiter | undefined;
  // eslint-disable-next-line no-var
  var __ncbicli_rate_limiter_has_key__: boolean | undefined;
}

/**
 * Get (or create) the singleton rate limiter.
 *
 * @param hasApiKey  Whether the user has an NCBI API key configured.
 *                   This determines the rate: 10/s with key, 3/s without.
 */
export function getRateLimiter(hasApiKey: boolean): RateLimiter {
  const rate = hasApiKey ? 10 : 3;

  if (globalThis.__ncbicli_rate_limiter__) {
    // If the API key status changed, update the rate
    if (globalThis.__ncbicli_rate_limiter_has_key__ !== hasApiKey) {
      globalThis.__ncbicli_rate_limiter__.setRate(rate);
      globalThis.__ncbicli_rate_limiter_has_key__ = hasApiKey;
    }
    return globalThis.__ncbicli_rate_limiter__;
  }

  const limiter = new RateLimiter(rate);
  globalThis.__ncbicli_rate_limiter__ = limiter;
  globalThis.__ncbicli_rate_limiter_has_key__ = hasApiKey;
  return limiter;
}
