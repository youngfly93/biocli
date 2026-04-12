/**
 * px/search — Free-text search across the ProteomeXchange federation.
 *
 * Queries the PROXI `/datasets` endpoint on ProteomeCentral, which federates
 * PRIDE, iProX, MassIVE, and jPOST under one search API. Results come back
 * in PROXI's "compact" tabular format (rows are lists of values), which
 * this adapter zips with `result_set.datasets_title_list` to produce flat
 * objects.
 *
 * Supported filters mirror the PROXI spec: free text (search), keywords,
 * modification name, instrument, contact, publication, year, repository,
 * plus pagination (pageSize/pageNumber).
 *
 * Deliberately does NOT expose `--species` in v1 — PROXI's species filter
 * takes scientific names only (rejects numeric NCBI taxonomy IDs like
 * 9606), which makes it a usability footgun. Users can free-text via
 * `--search "TP53 Homo sapiens"` instead.
 */

import { cli, Strategy } from '../../registry.js';
import { withMeta } from '../../types.js';
import { CliError } from '../../errors.js';
import { buildProxiUrl } from '../../databases/proteomexchange.js';

/** Map PROXI's raw column headers to camelCase field names on returned rows. */
const COLUMN_ALIAS: Record<string, string> = {
  'dataset identifier': 'accession',
  'title': 'title',
  'repository': 'repository',
  'species': 'species',
  'SDRF': 'sdrf',
  'files (raw/total)': 'filesCount',
  'instrument': 'instruments',
  'publications': 'publications',
  'lab head': 'labHead',
  'announce date': 'announceDate',
  'keywords': 'keywords',
};

/** Shape of the PROXI /datasets response (compact format). */
interface ProxiSearchResponse {
  datasets?: unknown[][];
  result_set?: {
    datasets_title_list?: string[];
    n_available_rows?: number;
    n_rows_returned?: number;
  };
  status?: { status_code?: number; error_code?: string | null; description?: string };
}

/**
 * Convert a compact PROXI row (list of values positional to column headers)
 * into a flat object keyed by the camelCase alias for each column.
 */
function rowToObject(row: unknown[], columnHeaders: string[]): Record<string, unknown> {
  const obj: Record<string, unknown> = {};
  for (let i = 0; i < columnHeaders.length; i++) {
    const rawKey = columnHeaders[i];
    const key = COLUMN_ALIAS[rawKey] ?? rawKey;
    obj[key] = row[i] ?? null;
  }
  return obj;
}

cli({
  site: 'px',
  name: 'search',
  description:
    'Search ProteomeXchange for datasets across PRIDE, iProX, MassIVE, and jPOST. ' +
    'Uses free-text and typed filters via the PROXI v0.1 spec.',
  database: 'proteomexchange',
  strategy: Strategy.PUBLIC,
  args: [
    { name: 'query', positional: true, required: false, help: 'Free-text query (title/description/keyword match)' },
    { name: 'keywords', help: 'Keyword field filter (comma-separated)' },
    { name: 'modification', help: 'Modification name, e.g. Phospho, Acetyl, Methyl' },
    { name: 'instrument', help: 'Instrument name filter' },
    { name: 'contact', help: 'Submitter/contact name filter' },
    { name: 'publication', help: 'Publication filter' },
    { name: 'year', help: 'Announce year (e.g. 2024)' },
    { name: 'repository', choices: ['PRIDE', 'iProX', 'MassIVE', 'jPOST'], help: 'Restrict to one repository' },
    { name: 'limit', type: 'int', default: 20, help: 'Max results per page' },
    { name: 'page', type: 'int', default: 1, help: 'Page number (1-indexed)' },
  ],
  examples: [
    {
      goal: 'Find phosphoproteomics datasets mentioning TP53',
      command: 'biocli px search TP53 --modification Phospho --limit 10 -f json',
    },
    {
      goal: 'Search PRIDE only for lung cancer proteomics studies',
      command: 'biocli px search "lung cancer" --repository PRIDE --limit 10 -f json',
    },
  ],
  whenToUse: 'Use when you need to discover candidate proteomics datasets across ProteomeXchange repositories before drilling into one accession.',
  columns: ['accession', 'title', 'repository', 'species', 'instruments', 'announceDate'],
  func: async (ctx, args) => {
    const query = args.query ? String(args.query).trim() : '';
    const limit = Math.max(1, Math.min(500, Number(args.limit) || 20));
    const page = Math.max(1, Number(args.page) || 1);

    const url = buildProxiUrl('/datasets', {
      search: query || undefined,
      keywords: args.keywords ? String(args.keywords) : undefined,
      modification: args.modification ? String(args.modification) : undefined,
      instrument: args.instrument ? String(args.instrument) : undefined,
      contact: args.contact ? String(args.contact) : undefined,
      publication: args.publication ? String(args.publication) : undefined,
      year: args.year ? String(args.year) : undefined,
      repository: args.repository ? String(args.repository) : undefined,
      pageSize: String(limit),
      pageNumber: String(page),
    });

    const response = await ctx.fetchJson(url) as ProxiSearchResponse;

    const columnHeaders = response.result_set?.datasets_title_list ?? [];
    const rawRows = response.datasets ?? [];
    if (!Array.isArray(rawRows) || columnHeaders.length === 0) {
      throw new CliError(
        'PARSE_ERROR',
        'PROXI /datasets response is missing datasets[] or result_set.datasets_title_list',
        'The upstream API format may have changed. Try again or check https://proteomecentral.proteomexchange.org/ for status.',
      );
    }

    const rows = rawRows.map(row => rowToObject(row as unknown[], columnHeaders));
    const totalCount = response.result_set?.n_available_rows ?? rows.length;

    return withMeta(rows, { totalCount, query });
  },
});
