/**
 * ensembl/xrefs — Cross-references for a gene symbol in Ensembl.
 *
 * Returns linked IDs in HGNC, UniProt, RefSeq, OMIM, etc.
 */

import { cli, Strategy } from '../../registry.js';
import { CliError } from '../../errors.js';
import { buildEnsemblUrl, isEnsemblId } from '../../databases/ensembl.js';
import { withMeta } from '../../types.js';

cli({
  site: 'ensembl',
  name: 'xrefs',
  description: 'Get cross-references for a gene',
  database: 'ensembl',
  strategy: Strategy.PUBLIC,
  args: [
    { name: 'symbol', positional: true, required: true, help: 'Gene symbol (e.g. BRCA2) or Ensembl ID (e.g. ENSG00000141510)' },
    { name: 'species', default: 'homo_sapiens', help: 'Species name' },
  ],
  columns: ['database', 'primaryId', 'displayId', 'description'],
  func: async (ctx, args) => {
    const symbol = String(args.symbol).trim();
    const species = String(args.species).toLowerCase().replace(/\s+/g, '_');

    const apiPath = isEnsemblId(symbol)
      ? `/xrefs/id/${symbol}`
      : `/xrefs/symbol/${species}/${symbol}`;

    const data = await ctx.fetchJson(
      buildEnsemblUrl(apiPath),
    ) as Record<string, unknown>[];

    if (!Array.isArray(data) || !data.length) {
      throw new CliError('NOT_FOUND', `No cross-references found for "${symbol}"`, 'Check the gene symbol');
    }

    const rows = data.map(item => ({
      database: String(item.dbname ?? ''),
      primaryId: String(item.primary_id ?? ''),
      displayId: String(item.display_id ?? ''),
      description: String(item.description ?? '').replace(/\s*\[Source:.*\]/, ''),
    }));

    return withMeta(rows, { totalCount: rows.length, query: symbol });
  },
});
