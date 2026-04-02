/**
 * geo/dataset — Get GEO dataset details by accession.
 *
 * Searches by accession (GSE, GDS, GPL, GSM) in the gds database,
 * then retrieves the full summary via esummary (JSON).
 */

import { cli, Strategy } from '../../registry.js';
import { CliError } from '../../errors.js';
import { buildEutilsUrl } from '../_shared/eutils.js';
import { truncate } from '../_shared/common.js';

cli({
  site: 'geo',
  name: 'dataset',
  description: 'Get GEO dataset details by accession',
  database: 'gds',
  strategy: Strategy.PUBLIC,
  args: [
    { name: 'accession', positional: true, required: true, help: 'GEO accession (e.g. GSE12345, GDS1234)' },
  ],
  columns: ['accession', 'title', 'organism', 'type', 'platform', 'samples', 'summary', 'date'],
  func: async (ctx, args) => {
    const acc = String(args.accession).toUpperCase();

    // Step 1: esearch by accession
    const searchResult = await ctx.fetchJson(buildEutilsUrl('esearch.fcgi', {
      db: 'gds',
      term: `${acc}[Accession]`,
      retmode: 'json',
    }));

    const result = searchResult as Record<string, unknown>;
    const esearchResult = result?.esearchresult as Record<string, unknown> | undefined;
    const ids: string[] = (esearchResult?.idlist as string[] | undefined) ?? [];

    if (!ids.length) {
      throw new CliError('NOT_FOUND', `GEO entry ${acc} not found`, 'Check that the accession is correct (e.g. GSE12345, GDS1234)');
    }

    // Step 2: esummary for full details
    const summaryResult = await ctx.fetchJson(buildEutilsUrl('esummary.fcgi', {
      db: 'gds',
      id: ids[0],
      retmode: 'json',
    }));

    const summary = summaryResult as Record<string, unknown>;
    const resultObj = summary?.result as Record<string, unknown> | undefined;
    const item = (resultObj?.[ids[0]] ?? {}) as Record<string, unknown>;

    return [{
      accession: String(item.accession ?? acc),
      title: String(item.title ?? ''),
      organism: String(item.taxon ?? ''),
      type: String(item.entrytype ?? ''),
      platform: String(item.gpl ?? ''),
      samples: Number(item.n_samples ?? 0),
      summary: truncate(String(item.summary ?? ''), 300),
      date: String(item.pdat ?? ''),
    }];
  },
});
