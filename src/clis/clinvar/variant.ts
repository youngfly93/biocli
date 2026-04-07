/**
 * clinvar/variant — Get ClinVar variant details by ID.
 *
 * Accepts a ClinVar variation ID (numeric) or accession (VCV*),
 * uses esearch + esummary (JSON) to retrieve detailed variant metadata.
 */

import { cli, Strategy } from '../../registry.js';
import { CliError } from '../../errors.js';
import { buildEutilsUrl } from '../_shared/eutils.js';

cli({
  site: 'clinvar',
  name: 'variant',
  description: 'Get ClinVar variant details by ID',
  database: 'clinvar',
  strategy: Strategy.PUBLIC,
  args: [
    { name: 'id', positional: true, required: true, help: 'ClinVar variation ID or accession (e.g. 37722, VCV000037722)' },
  ],
  columns: ['uid', 'title', 'gene', 'significance', 'condition', 'accession', 'type', 'assembly'],
  func: async (ctx, args) => {
    const query = String(args.id);
    // Try searching by ID or accession
    const searchTerm = /^\d+$/.test(query) ? `${query}[VariationID]` : `${query}[Accession]`;

    const searchResult = await ctx.fetchJson(buildEutilsUrl('esearch.fcgi', {
      db: 'clinvar', term: searchTerm, retmode: 'json',
    })) as Record<string, any>;
    const ids: string[] = searchResult?.esearchresult?.idlist ?? [];
    if (!ids.length) throw new CliError('NOT_FOUND', `ClinVar entry ${query} not found`);

    const summary = await ctx.fetchJson(buildEutilsUrl('esummary.fcgi', {
      db: 'clinvar', id: ids[0], retmode: 'json',
    })) as Record<string, any>;

    const item = summary?.result?.[ids[0]] ?? {};
    // NCBI renamed clinical_significance → germline_classification.description
    // and moved trait_set under germline_classification (2024/2025).
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
    const varType = item.obj_type ?? item.variation_type ?? '';

    return [{
      uid: ids[0],
      title: item.title ?? '',
      gene: genes,
      significance,
      condition: conditions,
      accession: item.accession ?? '',
      type: varType,
      assembly: item.assembly ?? '',
    }];
  },
});
