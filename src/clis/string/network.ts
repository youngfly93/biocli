/**
 * string/network — Get protein-protein interaction network from STRING.
 *
 * Accepts multiple proteins (comma-separated) and returns all interactions
 * between them.
 */

import { cli, Strategy } from '../../registry.js';
import { CliError } from '../../errors.js';
import { buildStringUrl, encodeStringIds } from '../../databases/string-db.js';
import { withMeta } from '../../types.js';

cli({
  site: 'string',
  name: 'network',
  description: 'Get protein interaction network',
  database: 'string',
  noBatch: true,
  strategy: Strategy.PUBLIC,
  args: [
    { name: 'proteins', positional: true, required: true, help: 'Comma-separated protein/gene names (e.g. TP53,BRCA1,EGFR)' },
    { name: 'species', type: 'int', default: 9606, help: 'NCBI taxonomy ID (default: 9606 human)' },
    { name: 'score', type: 'int', default: 400, help: 'Minimum combined score (0-1000)' },
  ],
  columns: ['proteinA', 'proteinB', 'score', 'experimentalScore', 'databaseScore'],
  func: async (ctx, args) => {
    const proteins = String(args.proteins).split(',').map(s => s.trim()).filter(Boolean);
    if (proteins.length < 2) {
      throw new CliError('ARGUMENT', 'At least 2 proteins required for a network', 'Example: biocli string network TP53,BRCA1,EGFR');
    }

    const species = String(args.species);
    const score = String(args.score);

    const data = await ctx.fetchJson(buildStringUrl('network', {
      identifiers: encodeStringIds(proteins),
      species,
      required_score: score,
    })) as Record<string, unknown>[];

    if (!Array.isArray(data) || !data.length) {
      throw new CliError('NOT_FOUND', `No interactions found between ${proteins.join(', ')}`, 'Try lowering --score or adding more proteins');
    }

    const rows = data.map(item => ({
      proteinA: String(item.preferredName_A ?? ''),
      proteinB: String(item.preferredName_B ?? ''),
      score: Number(item.score ?? 0),
      experimentalScore: Number(item.escore ?? 0),
      databaseScore: Number(item.dscore ?? 0),
    }));

    return withMeta(rows, { totalCount: rows.length, query: proteins.join(',') });
  },
});
