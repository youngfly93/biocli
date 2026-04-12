/**
 * ensembl/lookup — Look up a gene by symbol in Ensembl.
 *
 * Returns Ensembl gene ID, coordinates, biotype, and description.
 */

import { cli, Strategy } from '../../registry.js';
import { CliError } from '../../errors.js';
import { buildEnsemblUrl, isEnsemblId } from '../../databases/ensembl.js';

cli({
  site: 'ensembl',
  name: 'lookup',
  description: 'Look up a gene by symbol in Ensembl',
  database: 'ensembl',
  strategy: Strategy.PUBLIC,
  args: [
    { name: 'symbol', positional: true, required: true, help: 'Gene symbol (e.g. TP53) or Ensembl ID (e.g. ENSG00000141510)' },
    { name: 'species', default: 'homo_sapiens', help: 'Species name (e.g. homo_sapiens, mus_musculus)' },
  ],
  columns: ['ensemblId', 'symbol', 'biotype', 'chromosome', 'start', 'end', 'strand', 'description'],
  func: async (ctx, args) => {
    const symbol = String(args.symbol).trim();
    const species = String(args.species).toLowerCase().replace(/\s+/g, '_');

    const apiPath = isEnsemblId(symbol)
      ? `/lookup/id/${symbol}`
      : `/lookup/symbol/${species}/${symbol}`;

    const data = await ctx.fetchJson(
      buildEnsemblUrl(apiPath, { expand: '1' }),
    ) as Record<string, unknown>;

    if (!data || !data.id) {
      throw new CliError('NOT_FOUND', `Gene "${symbol}" not found in Ensembl for ${species}`, 'Check the gene symbol and species');
    }

    return [{
      ensemblId: String(data.id ?? ''),
      symbol: String(data.display_name ?? ''),
      biotype: String(data.biotype ?? ''),
      chromosome: String(data.seq_region_name ?? ''),
      start: Number(data.start ?? 0),
      end: Number(data.end ?? 0),
      strand: Number(data.strand ?? 0) === 1 ? '+' : '-',
      description: String(data.description ?? '').replace(/\s*\[Source:.*\]/, ''),
    }];
  },
});
