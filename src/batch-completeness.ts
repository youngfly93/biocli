import type { BatchCompletenessBreakdown, BatchSuccessRecord } from './batch-types.js';
import { BIOCLI_COMPLETENESS_VALUES, type BiocliCompleteness } from './types.js';
import { isRecord } from './utils.js';

const COMPLETENESS_VALUES = new Set<string>(BIOCLI_COMPLETENESS_VALUES);

function readCompleteness(result: unknown): BiocliCompleteness | undefined {
  if (!isRecord(result)) return undefined;
  const value = result.completeness;
  if (typeof value !== 'string' || !COMPLETENESS_VALUES.has(value)) return undefined;
  return value as BiocliCompleteness;
}

/**
 * Tally per-item completeness across successful batch records.
 *
 * Returns `undefined` when no record reports completeness, so batch summaries
 * for commands without the field keep their existing shape.
 */
export function summarizeBatchCompleteness(
  successes: BatchSuccessRecord[],
): BatchCompletenessBreakdown | undefined {
  const breakdown: BatchCompletenessBreakdown = { complete: 0, partial: 0, degraded: 0 };
  let reported = false;

  for (const entry of successes) {
    const completeness = readCompleteness(entry.result);
    if (!completeness) continue;
    reported = true;
    breakdown[completeness] += 1;
  }

  return reported ? breakdown : undefined;
}

/** Items that succeeded but returned incomplete data. */
export function countDegraded(breakdown: BatchCompletenessBreakdown): number {
  return breakdown.partial + breakdown.degraded;
}

/**
 * True when a result reports completeness and it is not `complete`.
 * Results without the field are never treated as incomplete.
 */
export function isIncompleteResult(result: unknown): boolean {
  const completeness = readCompleteness(result);
  return completeness === 'partial' || completeness === 'degraded';
}

/**
 * Inputs whose results are incomplete, in run order. Used for the run-end
 * warning and for `--retry-degraded` item selection.
 */
export function listDegradedInputs(successes: BatchSuccessRecord[]): string[] {
  return successes
    .filter(entry => isIncompleteResult(entry.result))
    .map(entry => entry.input);
}
