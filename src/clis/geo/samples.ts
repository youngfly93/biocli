/**
 * geo/samples — List samples in a GEO dataset.
 *
 * Searches for GSM (sample) entries associated with a given GEO series
 * accession, then retrieves sample metadata via esummary (JSON).
 */

import { cli, Strategy } from '../../registry.js';
import { CliError } from '../../errors.js';
import { buildEutilsUrl } from '../_shared/eutils.js';
import { clamp } from '../_shared/common.js';

cli({
  site: 'geo',
  name: 'samples',
  description: 'List samples in a GEO dataset',
  database: 'gds',
  strategy: Strategy.PUBLIC,
  args: [
    { name: 'accession', positional: true, required: true, help: 'GEO series accession (e.g. GSE12345)', producedBy: ['geo/search', 'aggregate/workflow-scout'] },
    { name: 'limit', type: 'int', default: 20, help: 'Max results (1-200)' },
  ],
  columns: ['accession', 'title', 'organism', 'type'],
  func: async (ctx, args) => {
    const acc = String(args.accession).toUpperCase();
    const limit = clamp(Number(args.limit), 1, 200);

    // Search for GSM samples within this series
    const searchResult = await ctx.fetchJson(buildEutilsUrl('esearch.fcgi', {
      db: 'gds',
      term: `${acc}[Accession] AND gsm[Entry Type]`,
      retmax: String(limit),
      retmode: 'json',
    }));

    const result = searchResult as Record<string, unknown>;
    const esearchResult = result?.esearchresult as Record<string, unknown> | undefined;
    const ids: string[] = (esearchResult?.idlist as string[] | undefined) ?? [];

    if (!ids.length) {
      throw new CliError('NOT_FOUND', `No samples found for ${acc}`, 'Check that the accession is a valid GEO series (GSE)');
    }

    // Get sample details
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
        accession: String(item.accession ?? `GSM${uid}`),
        title: String(item.title ?? ''),
        organism: String(item.taxon ?? ''),
        type: String(item.entrytype ?? ''),
      };
    });
  },
});
