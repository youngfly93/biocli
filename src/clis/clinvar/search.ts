/**
 * clinvar/search — Search ClinVar clinical variants.
 *
 * Uses the two-step esearch + esummary pattern:
 *   1. esearch to retrieve matching ClinVar IDs
 *   2. esummary (JSON) to get variant metadata
 */

import { cli, Strategy } from '../../registry.js';
import { CliError } from '../../errors.js';
import { buildEutilsUrl } from '../_shared/eutils.js';
import { withMeta } from '../../types.js';

cli({
  site: 'clinvar',
  name: 'search',
  description: 'Search ClinVar clinical variants',
  database: 'clinvar',
  strategy: Strategy.PUBLIC,
  args: [
    { name: 'query', positional: true, required: true, help: 'Search query (e.g. "BRCA1", "rs80357906", "breast cancer")' },
    { name: 'limit', type: 'int', default: 10, help: 'Max results (1-200)' },
  ],
  columns: ['uid', 'title', 'gene', 'significance', 'condition', 'accession'],
  func: async (ctx, args) => {
    const limit = Math.max(1, Math.min(Number(args.limit), 200));
    const query = String(args.query);

    // Step 1: esearch to get ClinVar IDs
    const searchResult = await ctx.fetchJson(buildEutilsUrl('esearch.fcgi', {
      db: 'clinvar', term: query, retmax: String(limit), retmode: 'json',
    })) as Record<string, any>;
    const ids: string[] = searchResult?.esearchresult?.idlist ?? [];
    const totalCount = Number(searchResult?.esearchresult?.count ?? 0);
    if (!ids.length) throw new CliError('NOT_FOUND', 'No ClinVar entries found');

    // Step 2: esummary to get variant details
    const summary = await ctx.fetchJson(buildEutilsUrl('esummary.fcgi', {
      db: 'clinvar', id: ids.join(','), retmode: 'json',
    })) as Record<string, any>;

    const uids: string[] = summary?.result?.uids ?? [];
    const rows = uids.map(uid => {
      const item = summary.result[uid] ?? {};
      // NCBI renamed ClinVar esummary fields in 2024/2025:
      //   clinical_significance → germline_classification.description
      //   trait_set (top-level)  → germline_classification.trait_set
      const germline = item.germline_classification ?? {};
      const genes = Array.isArray(item.genes) ? item.genes.map((g: any) => g.symbol).join(', ') : '';
      const significance = String(
        germline.description
        ?? (typeof item.clinical_significance === 'object'
          ? item.clinical_significance?.description ?? ''
          : item.clinical_significance ?? '')
      );
      const traitSet = germline.trait_set ?? item.trait_set;
      const conditions = Array.isArray(traitSet)
        ? traitSet.map((t: any) => t.trait_name).join('; ')
        : '';
      return {
        uid,
        title: item.title ?? '',
        gene: genes,
        significance,
        condition: conditions.slice(0, 60) + (conditions.length > 60 ? '...' : ''),
        accession: item.accession ?? '',
      };
    });
    return withMeta(rows, { totalCount, query });
  },
});
