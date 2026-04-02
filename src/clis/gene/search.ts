/**
 * gene/search — Search NCBI Gene database.
 *
 * Uses esearch to find Gene IDs matching the query, then esummary
 * (JSON mode) to retrieve gene metadata.
 */

import { cli, Strategy } from '../../registry.js';
import { CliError } from '../../errors.js';
import { buildEutilsUrl } from '../_shared/eutils.js';
import { parseGeneSummaries } from '../_shared/xml-helpers.js';
import { clamp } from '../_shared/common.js';
import { withMeta } from '../../types.js';

/** Map common organism names to NCBI search terms. */
const ORGANISM_MAP: Record<string, string> = {
  human: 'Homo sapiens',
  mouse: 'Mus musculus',
  rat: 'Rattus norvegicus',
  zebrafish: 'Danio rerio',
  fly: 'Drosophila melanogaster',
  worm: 'Caenorhabditis elegans',
  yeast: 'Saccharomyces cerevisiae',
  chicken: 'Gallus gallus',
  dog: 'Canis lupus familiaris',
  pig: 'Sus scrofa',
};

cli({
  site: 'gene',
  name: 'search',
  description: 'Search NCBI Gene database',
  database: 'gene',
  strategy: Strategy.PUBLIC,
  args: [
    { name: 'query', positional: true, required: true, help: 'Gene symbol or keyword (e.g. TP53, BRCA1)' },
    { name: 'limit', type: 'int', default: 10, help: 'Max results (1-200)' },
    { name: 'organism', default: 'human', help: 'Organism name (e.g. human, mouse, rat, zebrafish)' },
  ],
  columns: ['geneId', 'symbol', 'name', 'organism'],
  func: async (ctx, args) => {
    const limit = clamp(Number(args.limit), 1, 200);
    const orgInput = String(args.organism).toLowerCase().trim();
    const organism = ORGANISM_MAP[orgInput] ?? String(args.organism);

    // Build search term: "query[Gene Name] AND organism[Organism]"
    const query = String(args.query).trim();
    const term = `${query}[Gene Name] AND ${organism}[Organism]`;

    // Step 1: esearch to get Gene IDs
    const searchResult = await ctx.fetchJson(buildEutilsUrl('esearch.fcgi', {
      db: 'gene',
      term,
      retmax: String(limit),
      retmode: 'json',
    }));

    const result = searchResult as Record<string, unknown>;
    const esearchResult = result?.esearchresult as Record<string, unknown> | undefined;
    const geneIds: string[] = (esearchResult?.idlist as string[] | undefined) ?? [];
    const totalCount = Number(esearchResult?.count ?? 0);

    if (!geneIds.length) {
      throw new CliError(
        'NOT_FOUND',
        `No genes found for "${query}" in ${organism}`,
        'Try a different gene name/symbol or organism',
      );
    }

    // Step 2: esummary to get gene details (JSON mode works for gene db)
    const summaryResult = await ctx.fetchJson(buildEutilsUrl('esummary.fcgi', {
      db: 'gene',
      id: geneIds.join(','),
      retmode: 'json',
    }));

    const genes = parseGeneSummaries(summaryResult);
    if (!genes.length) {
      throw new CliError('PARSE_ERROR', 'Failed to parse gene summary data', 'Try again later');
    }

    return withMeta(genes, { totalCount, query });
  },
});
