/**
 * enrichr/analyze — Run gene set enrichment analysis via Enrichr.
 *
 * 2-step workflow: submits a gene list, then retrieves enrichment results
 * for the specified gene set library.
 */

import { cli, Strategy } from '../../registry.js';
import { CliError } from '../../errors.js';
import { submitGeneList, getEnrichment } from '../../databases/enrichr.js';
import { withMeta } from '../../types.js';

const DEFAULT_LIBRARY = 'KEGG_2021_Human';

cli({
  site: 'enrichr',
  name: 'analyze',
  description: 'Run gene set enrichment analysis',
  database: 'enrichr',
  strategy: Strategy.PUBLIC,
  args: [
    { name: 'genes', positional: true, required: true, help: 'Comma-separated gene symbols (e.g. TP53,BRCA1,EGFR,MYC,CDK2)' },
    { name: 'library', default: DEFAULT_LIBRARY, help: 'Gene set library (e.g. KEGG_2021_Human, GO_Biological_Process_2023, Reactome_2022)' },
    { name: 'limit', type: 'int', default: 20, help: 'Max results to show (1-100)' },
  ],
  columns: ['rank', 'term', 'adjustedPValue', 'combinedScore', 'genes'],
  func: async (_ctx, args) => {
    const geneList = String(args.genes).split(',').map(s => s.trim()).filter(Boolean);
    if (geneList.length < 2) {
      throw new CliError('ARGUMENT', 'At least 2 genes required for enrichment analysis', 'Example: biocli enrichr analyze TP53,BRCA1,EGFR,MYC,CDK2');
    }

    const library = String(args.library);
    const limit = Math.max(1, Math.min(Number(args.limit), 100));

    // Step 1: Submit gene list
    const userListId = await submitGeneList(geneList);

    // Step 2: Get enrichment results
    const results = await getEnrichment(userListId, library);

    if (!results.length) {
      throw new CliError('NOT_FOUND', `No enrichment results from ${library}`, 'Try a different library or add more genes');
    }

    // Take top results by combined score
    const rows = results.slice(0, limit).map(r => ({
      rank: Number(r.rank),
      term: String(r.term),
      adjustedPValue: Number(r.adjustedPValue).toExponential(2),
      combinedScore: Number(r.combinedScore).toFixed(1),
      genes: String(r.genes),
    }));

    return withMeta(rows, { totalCount: results.length, query: geneList.join(',') });
  },
});
