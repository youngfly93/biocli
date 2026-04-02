/**
 * geo/search — Search GEO datasets.
 *
 * Uses the two-step esearch + esummary pattern against db=gds:
 *   1. esearch to retrieve matching GEO DataSet IDs
 *   2. esummary (JSON) to get dataset metadata
 */

import { cli, Strategy } from '../../registry.js';
import { CliError } from '../../errors.js';
import { buildEutilsUrl } from '../_shared/eutils.js';
import { clamp } from '../_shared/common.js';

cli({
  site: 'geo',
  name: 'search',
  description: 'Search GEO datasets',
  database: 'gds',
  strategy: Strategy.PUBLIC,
  args: [
    { name: 'query', positional: true, required: true, help: 'Search query (e.g. "breast cancer RNA-seq")' },
    { name: 'limit', type: 'int', default: 10, help: 'Max results (1-50)' },
    { name: 'type', default: 'gse', choices: ['gse', 'gds', 'gpl', 'gsm'], help: 'Entry type filter' },
  ],
  columns: ['accession', 'title', 'organism', 'type', 'samples', 'date'],
  func: async (ctx, args) => {
    const limit = clamp(Number(args.limit), 1, 50);
    const typeFilter = String(args.type).toUpperCase();
    const term = `${args.query} AND ${typeFilter}[Entry Type]`;

    // Step 1: esearch to get GDS IDs
    const searchResult = await ctx.fetchJson(buildEutilsUrl('esearch.fcgi', {
      db: 'gds',
      term,
      retmax: String(limit),
      retmode: 'json',
    }));

    const result = searchResult as Record<string, unknown>;
    const esearchResult = result?.esearchresult as Record<string, unknown> | undefined;
    const ids: string[] = (esearchResult?.idlist as string[] | undefined) ?? [];

    if (!ids.length) {
      throw new CliError('NOT_FOUND', 'No GEO entries found', 'Try different search terms or a different entry type');
    }

    // Step 2: esummary to get dataset details
    const summaryResult = await ctx.fetchJson(buildEutilsUrl('esummary.fcgi', {
      db: 'gds',
      id: ids.join(','),
      retmode: 'json',
    }));

    const summary = summaryResult as Record<string, unknown>;
    const resultObj = summary?.result as Record<string, unknown> | undefined;
    const uids: string[] = (resultObj?.uids as string[] | undefined) ?? [];

    return uids.map(uid => {
      const item = (resultObj?.[uid] ?? {}) as Record<string, unknown>;
      return {
        accession: String(item.accession ?? `GDS${uid}`),
        title: String(item.title ?? ''),
        organism: String(item.taxon ?? ''),
        type: String(item.entrytype ?? ''),
        samples: Number(item.n_samples ?? 0),
        date: String(item.pdat ?? ''),
      };
    });
  },
});
