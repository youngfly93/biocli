/**
 * kegg/convert — Convert IDs between KEGG and other databases.
 *
 * Uses KEGG REST /conv endpoint for ID mapping between
 * KEGG gene IDs and NCBI Gene IDs, UniProt accessions, etc.
 */

import { cli, Strategy } from '../../registry.js';
import { CliError } from '../../errors.js';
import { buildKeggUrl, parseKeggTsv } from '../../databases/kegg.js';
import { withMeta } from '../../types.js';

cli({
  site: 'kegg',
  name: 'convert',
  description: 'Convert IDs between KEGG and external databases',
  database: 'kegg',
  strategy: Strategy.PUBLIC,
  args: [
    { name: 'id', positional: true, required: true, help: 'ID to convert (e.g. hsa:7157, ncbi-geneid:7157)' },
    { name: 'to', default: 'ncbi-geneid', choices: ['ncbi-geneid', 'ncbi-proteinid', 'uniprot'], help: 'Target database' },
  ],
  columns: ['source', 'target'],
  func: async (ctx, args) => {
    const id = String(args.id).trim();
    const target = String(args.to);

    // Determine direction: /conv/target/source
    const text = await ctx.fetchText(buildKeggUrl(`/conv/${target}/${id}`));
    if (!text.trim()) {
      throw new CliError('NOT_FOUND', `No conversion found for ${id} → ${target}`, 'Check the ID format');
    }

    const parsed = parseKeggTsv(text);
    const rows = parsed.map(p => ({
      source: p.key,
      target: p.value,
    }));

    return withMeta(rows, { totalCount: rows.length, query: id });
  },
});
