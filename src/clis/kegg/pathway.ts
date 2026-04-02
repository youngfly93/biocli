/**
 * kegg/pathway — Get KEGG pathway details.
 *
 * Uses KEGG REST /get endpoint to retrieve pathway information.
 */

import { cli, Strategy } from '../../registry.js';
import { CliError } from '../../errors.js';
import { buildKeggUrl, parseKeggEntry } from '../../databases/kegg.js';

cli({
  site: 'kegg',
  name: 'pathway',
  description: 'Get KEGG pathway details',
  database: 'kegg',
  strategy: Strategy.PUBLIC,
  args: [
    { name: 'id', positional: true, required: true, help: 'KEGG pathway ID (e.g. hsa05200, hsa00600)' },
  ],
  columns: ['id', 'name', 'description', 'class', 'genes', 'diseases'],
  func: async (ctx, args) => {
    const id = String(args.id).trim();

    const text = await ctx.fetchText(buildKeggUrl(`/get/${id}`));
    if (!text || text.includes('No such')) {
      throw new CliError('NOT_FOUND', `KEGG pathway ${id} not found`, 'Check the pathway ID (e.g. hsa05200)');
    }

    const entry = parseKeggEntry(text);

    // Count genes: GENE field has lines like "7157  TP53; tumor protein p53"
    const geneLines = (entry.GENE ?? '').split(/\d+\s+/).filter(Boolean);

    return [{
      id,
      name: entry.NAME ?? '',
      description: entry.DESCRIPTION ?? '',
      class: entry.CLASS ?? '',
      genes: `${geneLines.length} genes`,
      diseases: entry.DISEASE ?? '',
    }];
  },
});
