/**
 * Flatten a result value into a single tabular cell.
 *
 * Table-shaped formats (CSV, Markdown, table) have one cell per field, but
 * aggregate results nest arrays of objects — pathways, GO terms, interactions.
 * Stringifying those directly yields `[object Object]` repeated once per entry,
 * which silently destroys the data on the path most people use to load results
 * into R or a spreadsheet.
 *
 * Nested values are reduced to their most identifying scalar instead. Full
 * nested detail stays available in `-f json`, `-f yaml`, and `results.jsonl`.
 */

/** Field names, in priority order, that best identify a nested record. */
const LABEL_FIELDS = [
  'name',
  'title',
  'symbol',
  'label',
  'term',
  'description',
  'id',
  'accession',
  'identifier',
];

const MULTI_VALUE_SEPARATOR = '; ';

/** Reduce one nested record to a single readable label. */
function labelForObject(value: Record<string, unknown>): string {
  for (const field of LABEL_FIELDS) {
    const candidate = value[field];
    if (typeof candidate === 'string' && candidate.trim()) return candidate.trim();
    if (typeof candidate === 'number' || typeof candidate === 'boolean') return String(candidate);
  }

  // No conventional label: fall back to the first scalar entry so the cell
  // still carries information rather than a type name.
  for (const [key, candidate] of Object.entries(value)) {
    if (typeof candidate === 'string' && candidate.trim()) return `${key}=${candidate.trim()}`;
    if (typeof candidate === 'number' || typeof candidate === 'boolean') return `${key}=${candidate}`;
  }

  return '';
}

/**
 * Render any value as a single cell string.
 *
 * - primitives render as-is (`null`/`undefined` become an empty cell)
 * - arrays join their formatted entries with `; `
 * - objects reduce to their most identifying scalar
 */
export function formatCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);

  if (Array.isArray(value)) {
    return value
      .map(formatCell)
      .filter(entry => entry !== '')
      .join(MULTI_VALUE_SEPARATOR);
  }

  if (typeof value === 'object') {
    return labelForObject(value as Record<string, unknown>);
  }

  return String(value);
}
