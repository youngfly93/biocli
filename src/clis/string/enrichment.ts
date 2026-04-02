/**
 * string/enrichment — Functional enrichment analysis via STRING.
 *
 * Given a set of proteins, returns enriched GO terms, KEGG pathways,
 * Reactome pathways, etc.
 */

import { cli, Strategy } from '../../registry.js';
import { CliError } from '../../errors.js';
import { buildStringUrl, encodeStringIds } from '../../databases/string-db.js';
import { withMeta } from '../../types.js';

cli({
  site: 'string',
  name: 'enrichment',
  description: 'Functional enrichment analysis for a gene set',
  database: 'string',
  strategy: Strategy.PUBLIC,
  args: [
    { name: 'proteins', positional: true, required: true, help: 'Comma-separated protein/gene names (e.g. TP53,BRCA1,EGFR,MYC)' },
    { name: 'species', type: 'int', default: 9606, help: 'NCBI taxonomy ID (default: 9606 human)' },
  ],
  columns: ['category', 'term', 'description', 'fdr', 'genes'],
  func: async (ctx, args) => {
    const proteins = String(args.proteins).split(',').map(s => s.trim()).filter(Boolean);
    if (proteins.length < 2) {
      throw new CliError('ARGUMENT', 'At least 2 proteins required for enrichment', 'Example: biocli string enrichment TP53,BRCA1,EGFR,MYC');
    }

    const species = String(args.species);

    const data = await ctx.fetchJson(buildStringUrl('enrichment', {
      identifiers: encodeStringIds(proteins),
      species,
    })) as Record<string, unknown>[];

    if (!Array.isArray(data) || !data.length) {
      throw new CliError('NOT_FOUND', 'No enrichment results', 'Try adding more proteins or checking names');
    }

    const rows = data.map(item => {
      const inputGenes = item.inputGenes as string[] | string | undefined;
      const geneList = Array.isArray(inputGenes) ? inputGenes.join(',') : String(inputGenes ?? '');
      return {
        category: String(item.category ?? ''),
        term: String(item.term ?? ''),
        description: String(item.description ?? ''),
        fdr: Number(item.fdr ?? 1).toExponential(2),
        genes: geneList,
      };
    });

    // Sort by FDR (most significant first)
    rows.sort((a, b) => parseFloat(a.fdr) - parseFloat(b.fdr));

    return withMeta(rows, { totalCount: rows.length, query: proteins.join(',') });
  },
});
