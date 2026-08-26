import { describe, expect, it } from 'vitest';
import { RateLimiter } from './rate-limiter.js';

describe('RateLimiter.penalize', () => {
  it('holds every acquisition until the cooldown expires', async () => {
    const limiter = new RateLimiter(10);
    limiter.penalize(120);

    const started = Date.now();
    await limiter.acquire();
    expect(Date.now() - started).toBeGreaterThanOrEqual(100);
  });

  it('holds concurrent waiters, not only the caller that triggered it', async () => {
    const limiter = new RateLimiter(10);
    limiter.penalize(120);

    const started = Date.now();
    await Promise.all([limiter.acquire(), limiter.acquire(), limiter.acquire()]);
    expect(Date.now() - started).toBeGreaterThanOrEqual(100);
  });

  it('clears the current window so retries start from a clean budget', async () => {
    const limiter = new RateLimiter(2);
    await limiter.acquire();
    await limiter.acquire();

    // Window is now full; penalizing resets it so the wait is the cooldown
    // rather than the cooldown stacked on top of the old window.
    limiter.penalize(50);
    const started = Date.now();
    await limiter.acquire();
    const elapsed = Date.now() - started;
    expect(elapsed).toBeGreaterThanOrEqual(40);
    expect(elapsed).toBeLessThan(900);
  });

  it('keeps the longest cooldown when penalized repeatedly', () => {
    const limiter = new RateLimiter(3);
    limiter.penalize(500);
    const afterLong = limiter.cooldownRemainingMs;
    limiter.penalize(10);
    expect(limiter.cooldownRemainingMs).toBeGreaterThanOrEqual(afterLong - 20);
  });

  it('ignores non-positive and non-finite penalties', async () => {
    const limiter = new RateLimiter(5);
    limiter.penalize(0);
    limiter.penalize(-100);
    limiter.penalize(Number.NaN);
    expect(limiter.cooldownRemainingMs).toBe(0);

    const started = Date.now();
    await limiter.acquire();
    expect(Date.now() - started).toBeLessThan(50);
  });
});
