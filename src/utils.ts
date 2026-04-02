/**
 * Simple utility functions for ncbicli.
 */

/** Clamp a numeric value to the inclusive range [min, max]. */
export function clamp(value: number, min: number, max: number): number {
  if (min > max) throw new RangeError(`clamp: min (${min}) must be <= max (${max})`);
  return value < min ? min : value > max ? max : value;
}

/** Return a promise that resolves after the given number of milliseconds. */
export function sleep(ms: number): Promise<void> {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

/** Type guard: returns true if the value is a non-null plain object. */
export function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Map an array through an async function with bounded concurrency.
 *
 * At most `concurrency` invocations of `fn` run simultaneously.
 * Results are returned in the same order as the input items.
 */
export async function mapConcurrent<T, R>(
  items: T[],
  fn: (item: T, index: number) => Promise<R>,
  concurrency: number,
): Promise<R[]> {
  if (concurrency < 1) throw new RangeError('concurrency must be >= 1');
  if (items.length === 0) return [];

  const results: R[] = new Array(items.length);
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (nextIndex < items.length) {
      const idx = nextIndex++;
      results[idx] = await fn(items[idx], idx);
    }
  }

  const workers = Array.from(
    { length: Math.min(concurrency, items.length) },
    () => worker(),
  );

  await Promise.all(workers);
  return results;
}
