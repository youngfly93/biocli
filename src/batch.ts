/**
 * Batch input support for biocli commands.
 *
 * Resolves a list of IDs/queries from:
 *   1. --input <file>  (one ID per line)
 *   2. --input -       (stdin, one per line)
 *   3. Comma-separated positional arg (e.g. "TP53,BRCA1,EGFR")
 *
 * Returns null if no batch mode is detected (single-value execution).
 */

import { readFileSync } from 'node:fs';

/**
 * Parse a batch input source into an array of individual values.
 * Returns null if the input is a single non-batch value.
 */
export function parseBatchInput(
  positionalValue: string | undefined,
  inputFlag: string | undefined,
): string[] | null {
  // Priority 1: --input flag (file or stdin)
  if (inputFlag) {
    let raw: string;
    if (inputFlag === '-') {
      // Read from stdin (synchronous — assumes piped input, not interactive)
      raw = readFileSync(0, 'utf-8');
    } else {
      raw = readFileSync(inputFlag, 'utf-8');
    }
    const items = raw
      .split(/[\n\r]+/)
      .map(line => line.trim())
      .filter(line => line && !line.startsWith('#'));
    return items.length > 0 ? items : null;
  }

  // Priority 2: Comma-separated positional arg
  if (positionalValue && positionalValue.includes(',')) {
    const items = positionalValue
      .split(',')
      .map(s => s.trim())
      .filter(Boolean);
    if (items.length > 1) return items;
  }

  return null;
}

/**
 * Merge batch results into a flat array.
 * Handles both plain arrays and ResultWithMeta objects.
 */
export function mergeBatchResults(results: unknown[]): unknown[] {
  const merged: unknown[] = [];
  for (const result of results) {
    if (result === null || result === undefined) continue;
    if (Array.isArray(result)) {
      merged.push(...result);
    } else if (typeof result === 'object' && 'rows' in (result as Record<string, unknown>)) {
      // ResultWithMeta
      const rows = (result as Record<string, unknown>).rows;
      if (Array.isArray(rows)) merged.push(...rows);
      else merged.push(result);
    } else {
      merged.push(result);
    }
  }
  return merged;
}
