import { describe, expect, it } from 'vitest';
import { runBatch } from './batch-runner.js';

describe('runBatch', () => {
  it('collects successes in input order with bounded concurrency', async () => {
    const seen: string[] = [];
    const result = await runBatch({
      items: ['TP53', 'BRCA1', 'EGFR'],
      concurrency: 2,
      executor: async (item) => {
        seen.push(item);
        return { gene: item };
      },
    });

    expect(seen.sort()).toEqual(['BRCA1', 'EGFR', 'TP53']);
    expect(result.successes.map(entry => entry.item)).toEqual(['TP53', 'BRCA1', 'EGFR']);
    expect(result.failures).toHaveLength(0);
  });

  it('retries failed items up to the configured retry count', async () => {
    let attempts = 0;
    const result = await runBatch({
      items: ['TP53'],
      concurrency: 1,
      retries: 1,
      executor: async () => {
        attempts += 1;
        if (attempts === 1) throw new Error('transient');
        return { ok: true };
      },
    });

    expect(attempts).toBe(2);
    expect(result.successes).toHaveLength(1);
    expect(result.successes[0].attempts).toBe(2);
  });

  it('records failures after retries are exhausted', async () => {
    const result = await runBatch({
      items: ['TP53'],
      concurrency: 1,
      retries: 1,
      executor: async () => {
        throw new Error('still bad');
      },
    });

    expect(result.successes).toHaveLength(0);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0].attempts).toBe(2);
  });
});
