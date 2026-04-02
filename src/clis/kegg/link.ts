/**
 * kegg/link — Find cross-references for a gene in KEGG.
 *
 * Uses KEGG REST /link endpoint to find pathways, diseases, or
 * other database cross-references for a given gene.
 */

import { cli, Strategy } from '../../registry.js';
import { CliError } from '../../errors.js';
import { buildKeggUrl, parseKeggTsv } from '../../databases/kegg.js';
import { withMeta } from '../../types.js';

cli({
  site: 'kegg',
  name: 'link',
  description: 'Find KEGG cross-references for a gene',
  database: 'kegg',
  strategy: Strategy.PUBLIC,
  args: [
    { name: 'gene', positional: true, required: true, help: 'KEGG gene ID (e.g. hsa:7157) or comma-separated list' },
    { name: 'target', default: 'pathway', choices: ['pathway', 'disease', 'drug', 'compound'], help: 'Target database to link to' },
  ],
  columns: ['source', 'target'],
  func: async (ctx, args) => {
    const gene = String(args.gene).trim();
    const target = String(args.target);

    const text = await ctx.fetchText(buildKeggUrl(`/link/${target}/${gene}`));
    if (!text.trim()) {
      throw new CliError('NOT_FOUND', `No ${target} links found for ${gene}`, 'Check the gene ID format (e.g. hsa:7157)');
    }

    const parsed = parseKeggTsv(text);
    const rows = parsed.map(p => ({
      source: p.key,
      target: p.value,
    }));

    return withMeta(rows, { totalCount: rows.length, query: gene });
  },
});
