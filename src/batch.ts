/**
 * Batch input support for biocli commands.
 *
 * Resolves a list of IDs/queries from:
 *   1. --input / --input-file <file>
 *   2. --input / --input-file -
 *   3. Comma-separated positional arg (e.g. "TP53,BRCA1,EGFR")
 *
 * Returns null if no batch mode is detected (single-value execution).
 */

import { readFileSync } from 'node:fs';

export type BatchInputFormat = 'auto' | 'text' | 'csv' | 'tsv' | 'jsonl';

export interface BatchInputOptions {
  positionalValue?: string;
  input?: string;
  inputFile?: string;
  inputFormat?: BatchInputFormat | string;
  key?: string;
}

function splitTextLines(raw: string): string[] {
  return raw
    .split(/[\n\r]+/)
    .map(line => line.trim())
    .filter(line => line && !line.startsWith('#'));
}

function parseDelimited(raw: string, delimiter: ',' | '\t'): string[] {
  const lines = raw
    .split(/[\n\r]+/)
    .map(line => line.trim())
    .filter(line => line && !line.startsWith('#'));
  if (lines.length === 0) return [];

  const rows = lines.map(line => line.split(delimiter).map(cell => cell.trim()));
  const header = rows[0];
  const hasHeader = header.some(cell => /[A-Za-z_]/.test(cell));
  const dataRows = hasHeader ? rows.slice(1) : rows;
  const keyIndex = 0;
  return dataRows
    .map(row => row[keyIndex] ?? '')
    .map(value => value.trim())
    .filter(Boolean);
}

function parseDelimitedByKey(raw: string, delimiter: ',' | '\t', key: string): string[] {
  const lines = raw
    .split(/[\n\r]+/)
    .map(line => line.trim())
    .filter(line => line && !line.startsWith('#'));
  if (lines.length === 0) return [];

  const rows = lines.map(line => line.split(delimiter).map(cell => cell.trim()));
  const header = rows[0];
  const keyIndex = header.findIndex(cell => cell === key);
  if (keyIndex === -1) {
    throw new Error(`Batch input key "${key}" was not found in the ${delimiter === '\t' ? 'TSV' : 'CSV'} header.`);
  }
  return rows
    .slice(1)
    .map(row => row[keyIndex] ?? '')
    .map(value => value.trim())
    .filter(Boolean);
}

function parseJsonl(raw: string, key: string): string[] {
  const lines = raw
    .split(/[\n\r]+/)
    .map(line => line.trim())
    .filter(line => line && !line.startsWith('#'));
  return lines
    .map((line) => JSON.parse(line) as Record<string, unknown>)
    .map((row) => row[key])
    .filter((value): value is string | number => typeof value === 'string' || typeof value === 'number')
    .map(value => String(value).trim())
    .filter(Boolean);
}

function inferFormat(source: string | undefined, explicit: string | undefined): BatchInputFormat {
  const normalized = String(explicit ?? 'auto').trim().toLowerCase();
  if (normalized === 'text' || normalized === 'csv' || normalized === 'tsv' || normalized === 'jsonl') {
    return normalized;
  }
  if (!source || source === '-') return 'text';
  if (source.endsWith('.csv')) return 'csv';
  if (source.endsWith('.tsv')) return 'tsv';
  if (source.endsWith('.jsonl')) return 'jsonl';
  return 'text';
}

function parseBatchSource(raw: string, format: BatchInputFormat, key?: string): string[] {
  if (format === 'text') return splitTextLines(raw);
  if (format === 'csv') return key ? parseDelimitedByKey(raw, ',', key) : parseDelimited(raw, ',');
  if (format === 'tsv') return key ? parseDelimitedByKey(raw, '\t', key) : parseDelimited(raw, '\t');
  return parseJsonl(raw, key ?? 'id');
}

/**
 * Parse a batch input source into an array of individual values.
 * Returns null if the input is a single non-batch value.
 */
export function parseBatchInput(
  positionalValueOrOptions: string | BatchInputOptions | undefined,
  inputFlag?: string,
): string[] | null {
  const options: BatchInputOptions = typeof positionalValueOrOptions === 'object' && positionalValueOrOptions !== null
    ? positionalValueOrOptions
    : {
      positionalValue: positionalValueOrOptions,
      input: inputFlag,
    };

  const source = options.inputFile ?? options.input;

  // Priority 1: --input / --input-file flag (file or stdin)
  if (source) {
    let raw: string;
    if (source === '-') {
      // Read from stdin (synchronous — assumes piped input, not interactive)
      raw = readFileSync(0, 'utf-8');
    } else {
      raw = readFileSync(source, 'utf-8');
    }
    const format = inferFormat(source, options.inputFormat);
    const items = parseBatchSource(raw, format, options.key);
    return items.length > 0 ? items : null;
  }

  // Priority 2: Comma-separated positional arg
  if (options.positionalValue && options.positionalValue.includes(',')) {
    const items = options.positionalValue
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
