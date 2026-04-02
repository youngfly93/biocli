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

cli({
  site: 'clinvar',
  name: 'search',
  description: 'Search ClinVar clinical variants',
  database: 'clinvar',
  strategy: Strategy.PUBLIC,
  args: [
    { name: 'query', positional: true, required: true, help: 'Search query (e.g. "BRCA1", "rs80357906", "breast cancer")' },
    { name: 'limit', type: 'int', default: 10, help: 'Max results (1-50)' },
  ],
  columns: ['uid', 'title', 'gene', 'significance', 'condition', 'accession'],
  func: async (ctx, args) => {
    const limit = Math.max(1, Math.min(Number(args.limit), 50));

    // Step 1: esearch to get ClinVar IDs
    const searchResult = await ctx.fetchJson(buildEutilsUrl('esearch.fcgi', {
      db: 'clinvar', term: String(args.query), retmax: String(limit), retmode: 'json',
    })) as Record<string, any>;
    const ids: string[] = searchResult?.esearchresult?.idlist ?? [];
    if (!ids.length) throw new CliError('NOT_FOUND', 'No ClinVar entries found');

    // Step 2: esummary to get variant details
    const summary = await ctx.fetchJson(buildEutilsUrl('esummary.fcgi', {
      db: 'clinvar', id: ids.join(','), retmode: 'json',
    })) as Record<string, any>;

    const uids: string[] = summary?.result?.uids ?? [];
    return uids.map(uid => {
      const item = summary.result[uid] ?? {};
      // ClinVar esummary has: title, clinical_significance, genes (array of {symbol}),
      // trait_set (array of {trait_name}), accession, variation_set
      const genes = Array.isArray(item.genes) ? item.genes.map((g: any) => g.symbol).join(', ') : '';
      const significance = typeof item.clinical_significance === 'object'
        ? item.clinical_significance?.description ?? ''
        : String(item.clinical_significance ?? '');
      const conditions = Array.isArray(item.trait_set)
        ? item.trait_set.map((t: any) => t.trait_name).join('; ')
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
  },
});
