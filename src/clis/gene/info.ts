/**
 * gene/info — Get gene details by NCBI Gene ID.
 *
 * Uses esummary (JSON mode) to retrieve comprehensive gene metadata
 * for a single Gene ID.
 */

import { cli, Strategy } from '../../registry.js';
import { CliError } from '../../errors.js';
import { buildEutilsUrl } from '../_shared/eutils.js';
import { parseGeneSummaries } from '../_shared/xml-helpers.js';

cli({
  site: 'gene',
  name: 'info',
  description: 'Get gene details by NCBI Gene ID',
  database: 'gene',
  strategy: Strategy.PUBLIC,
  args: [
    { name: 'id', positional: true, required: true, help: 'NCBI Gene ID (e.g. 7157 for TP53)' },
  ],
  columns: ['geneId', 'symbol', 'name', 'organism', 'summary', 'chromosome', 'location'],
  func: async (ctx, args) => {
    const geneId = String(args.id).trim();
    if (!/^\d+$/.test(geneId)) {
      throw new CliError('ARGUMENT', `Invalid Gene ID: "${geneId}"`, 'Gene ID must be a numeric identifier (e.g. 7157 for TP53)');
    }

    const summaryResult = await ctx.fetchJson(buildEutilsUrl('esummary.fcgi', {
      db: 'gene',
      id: geneId,
      retmode: 'json',
    }));

    const genes = parseGeneSummaries(summaryResult);
    if (!genes.length) {
      throw new CliError('NOT_FOUND', `Gene ID ${geneId} not found`, 'Check that the Gene ID is correct (e.g. 7157 for TP53)');
    }

    return genes;
  },
});
