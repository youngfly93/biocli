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

  it('keeps the rate window intact so a cooldown cannot hand back budget', async () => {
    const limiter = new RateLimiter(2);
    await limiter.acquire();
    await limiter.acquire();

    // The window is full. A short cooldown must not release the next request
    // early — otherwise a retry fires inside a window it should have waited
    // out, which is exactly how two requests landed in a one-request budget.
    limiter.penalize(50);
    const started = Date.now();
    await limiter.acquire();
    expect(Date.now() - started).toBeGreaterThanOrEqual(900);
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
