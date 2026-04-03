/**
 * aggregate/enrichment — Combined enrichment analysis from Enrichr + STRING.
 *
 * Queries both Enrichr and STRING functional enrichment in parallel,
 * merges and deduplicates results into a unified enrichment report.
 */

import { cli, Strategy } from '../../registry.js';
import { CliError } from '../../errors.js';
import { submitGeneList, getEnrichment } from '../../databases/enrichr.js';
import { buildStringUrl, encodeStringIds } from '../../databases/string-db.js';
import { createHttpContextForDatabase } from '../../databases/index.js';
import { wrapResult } from '../../types.js';

interface EnrichmentResult {
  term: string;
  category: string;
  source: string;
  pValue: string;
  genes: string;
}

cli({
  site: 'aggregate',
  name: 'enrichment',
  description: 'Combined pathway enrichment from Enrichr + STRING',
  database: 'aggregate',
  strategy: Strategy.PUBLIC,
  defaultFormat: 'json',
  timeoutSeconds: 60,
  args: [
    { name: 'genes', positional: true, required: true, help: 'Comma-separated gene symbols (e.g. TP53,BRCA1,EGFR,MYC,CDK2)' },
    { name: 'library', default: 'KEGG_2021_Human', help: 'Enrichr library (e.g. GO_Biological_Process_2023, Reactome_2022)' },
    { name: 'limit', type: 'int', default: 20, help: 'Max results per source (1-50)' },
    { name: 'species', type: 'int', default: 9606, help: 'NCBI taxonomy ID for STRING (default: 9606)' },
  ],
  columns: ['term', 'category', 'source', 'pValue', 'genes'],
  func: async (_ctx, args) => {
    const geneList = String(args.genes).split(',').map(s => s.trim()).filter(Boolean);
    if (geneList.length < 2) {
      throw new CliError('ARGUMENT', 'At least 2 genes required', 'Example: biocli aggregate enrichment TP53,BRCA1,EGFR,MYC,CDK2');
    }

    const library = String(args.library);
    const limit = Math.max(1, Math.min(Number(args.limit), 50));
    const species = String(args.species);
    const errors: string[] = [];

    // Run both in parallel
    const [enrichrResult, stringResult] = await Promise.allSettled([
      // Enrichr: 2-step workflow
      (async (): Promise<EnrichmentResult[]> => {
        const userListId = await submitGeneList(geneList);
        const results = await getEnrichment(userListId, library);
        return results.slice(0, limit).map(r => ({
          term: String(r.term),
          category: library,
          source: 'Enrichr',
          pValue: Number(r.adjustedPValue).toExponential(2),
          genes: String(r.genes),
        }));
      })(),

      // STRING functional enrichment
      (async (): Promise<EnrichmentResult[]> => {
        const stringCtx = createHttpContextForDatabase('string');
        const data = await stringCtx.fetchJson(buildStringUrl('enrichment', {
          identifiers: encodeStringIds(geneList),
          species,
        })) as Record<string, unknown>[];

        if (!Array.isArray(data)) return [];

        return data
          .filter(item => {
            // Only keep KEGG/GO/Reactome categories
            const cat = String(item.category ?? '');
            return ['Process', 'Function', 'Component', 'KEGG', 'Reactome'].some(c => cat.includes(c));
          })
          .slice(0, limit)
          .map(item => {
            const inputGenes = item.inputGenes;
            const geneStr = Array.isArray(inputGenes) ? inputGenes.join(',') : String(inputGenes ?? '');
            return {
              term: String(item.description ?? item.term ?? ''),
              category: String(item.category ?? ''),
              source: 'STRING',
              pValue: Number(item.fdr ?? 1).toExponential(2),
              genes: geneStr,
            };
          });
      })(),
    ]);

    const rows: EnrichmentResult[] = [];

    if (enrichrResult.status === 'fulfilled') {
      rows.push(...enrichrResult.value);
    } else {
      errors.push(`Enrichr: ${enrichrResult.reason}`);
    }

    if (stringResult.status === 'fulfilled') {
      rows.push(...stringResult.value);
    } else {
      errors.push(`STRING: ${stringResult.reason}`);
    }

    if (!rows.length) {
      throw new CliError('NOT_FOUND', 'No enrichment results from any source',
        errors.length ? `Errors: ${errors.join('; ')}` : 'Try adding more genes');
    }

    // Sort by p-value
    rows.sort((a, b) => parseFloat(a.pValue) - parseFloat(b.pValue));

    const activeSources = [...new Set(rows.map(r => r.source))];
    return wrapResult(rows, {
      sources: activeSources,
      warnings: errors,
      query: geneList.join(','),
    });
  },
});
