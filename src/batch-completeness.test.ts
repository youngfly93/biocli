import { describe, expect, it } from 'vitest';
import {
  countDegraded,
  isIncompleteResult,
  listDegradedInputs,
  summarizeBatchCompleteness,
} from './batch-completeness.js';
import type { BatchSuccessRecord } from './batch-types.js';

function record(input: string, completeness?: string, index = 0): BatchSuccessRecord {
  return {
    input,
    index,
    attempts: 1,
    succeededAt: '2026-01-01T00:00:00.000Z',
    result: completeness === undefined ? { symbol: input } : { symbol: input, completeness },
  };
}

describe('summarizeBatchCompleteness', () => {
  it('returns undefined when no result reports completeness', () => {
    expect(summarizeBatchCompleteness([record('A'), record('B', undefined, 1)])).toBeUndefined();
  });

  it('tallies each completeness state', () => {
    const breakdown = summarizeBatchCompleteness([
      record('EGFR', 'complete', 0),
      record('KRAS', 'complete', 1),
      record('TP53', 'partial', 2),
      record('ZZZFAKE1', 'degraded', 3),
    ]);
    expect(breakdown).toEqual({ complete: 2, partial: 1, degraded: 1 });
  });

  it('ignores unknown completeness values', () => {
    expect(summarizeBatchCompleteness([record('A', 'banana')])).toBeUndefined();
  });

  it('counts reported items even when others omit the field', () => {
    const breakdown = summarizeBatchCompleteness([
      record('A', 'complete', 0),
      record('B', undefined, 1),
    ]);
    expect(breakdown).toEqual({ complete: 1, partial: 0, degraded: 0 });
  });
});

describe('countDegraded', () => {
  it('sums partial and degraded but not complete', () => {
    expect(countDegraded({ complete: 10, partial: 2, degraded: 3 })).toBe(5);
    expect(countDegraded({ complete: 10, partial: 0, degraded: 0 })).toBe(0);
  });
});

describe('isIncompleteResult', () => {
  it.each([
    ['partial', true],
    ['degraded', true],
    ['complete', false],
    ['banana', false],
  ])('treats %s as incomplete=%s', (completeness, expected) => {
    expect(isIncompleteResult({ completeness })).toBe(expected);
  });

  it('never treats a result without completeness as incomplete', () => {
    expect(isIncompleteResult({ symbol: 'EGFR' })).toBe(false);
    expect(isIncompleteResult(null)).toBe(false);
    expect(isIncompleteResult('EGFR')).toBe(false);
  });
});

describe('listDegradedInputs', () => {
  it('returns incomplete inputs in run order', () => {
    expect(listDegradedInputs([
      record('EGFR', 'partial', 0),
      record('KRAS', 'complete', 1),
      record('ZZZFAKE1', 'degraded', 2),
    ])).toEqual(['EGFR', 'ZZZFAKE1']);
  });

  it('returns an empty list when every item is complete', () => {
    expect(listDegradedInputs([record('EGFR', 'complete')])).toEqual([]);
  });
});
