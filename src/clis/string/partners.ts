/**
 * string/partners — Find interaction partners for a protein in STRING.
 */

import { cli, Strategy } from '../../registry.js';
import { CliError } from '../../errors.js';
import { buildStringUrl } from '../../databases/string-db.js';
import { withMeta } from '../../types.js';

cli({
  site: 'string',
  name: 'partners',
  description: 'Find protein interaction partners',
  database: 'string',
  strategy: Strategy.PUBLIC,
  args: [
    { name: 'protein', positional: true, required: true, help: 'Protein/gene name (e.g. TP53)' },
    { name: 'limit', type: 'int', default: 10, help: 'Max partners (1-50)' },
    { name: 'species', type: 'int', default: 9606, help: 'NCBI taxonomy ID (default: 9606 human)' },
    { name: 'score', type: 'int', default: 400, help: 'Minimum combined score (0-1000)' },
  ],
  columns: ['partnerA', 'partnerB', 'score', 'experimentalScore', 'databaseScore'],
  func: async (ctx, args) => {
    const protein = String(args.protein);
    const species = String(args.species);
    const limit = Math.max(1, Math.min(Number(args.limit), 50));
    const score = String(args.score);

    const data = await ctx.fetchJson(buildStringUrl('interaction_partners', {
      identifiers: protein,
      species,
      limit: String(limit),
      required_score: score,
    })) as Record<string, unknown>[];

    if (!Array.isArray(data) || !data.length) {
      throw new CliError('NOT_FOUND', `No interaction partners found for ${protein}`, 'Check the protein name or lower --score threshold');
    }

    const rows = data.map(item => ({
      partnerA: String(item.preferredName_A ?? ''),
      partnerB: String(item.preferredName_B ?? ''),
      score: Number(item.score ?? 0),
      experimentalScore: Number(item.escore ?? 0),
      databaseScore: Number(item.dscore ?? 0),
    }));

    return withMeta(rows, { totalCount: rows.length, query: protein });
  },
});
