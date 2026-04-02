/**
 * taxonomy/lookup — Look up NCBI Taxonomy by name or ID.
 *
 * Uses esearch (when given a name) to find taxonomy IDs,
 * then efetch (XML) to retrieve full taxonomic metadata.
 * If given a numeric ID, skips directly to efetch.
 */

import { cli, Strategy } from '../../registry.js';
import { CliError } from '../../errors.js';
import { buildEutilsUrl } from '../_shared/eutils.js';

cli({
  site: 'taxonomy',
  name: 'lookup',
  description: 'Look up NCBI Taxonomy by name or ID',
  database: 'taxonomy',
  strategy: Strategy.PUBLIC,
  args: [
    { name: 'query', positional: true, required: true, help: 'Organism name or Taxonomy ID (e.g. "Homo sapiens", 9606)' },
    { name: 'limit', type: 'int', default: 5, help: 'Max results' },
  ],
  columns: ['taxId', 'name', 'commonName', 'rank', 'division', 'lineage'],
  func: async (ctx, args) => {
    const query = String(args.query);
    const limit = Math.max(1, Math.min(Number(args.limit), 20));

    // If numeric, treat as taxonomy ID; otherwise search by name
    let ids: string[];
    if (/^\d+$/.test(query)) {
      ids = [query];
    } else {
      const searchResult = await ctx.fetchJson(buildEutilsUrl('esearch.fcgi', {
        db: 'taxonomy', term: query, retmax: String(limit), retmode: 'json',
      })) as Record<string, any>;
      ids = searchResult?.esearchresult?.idlist ?? [];
      if (!ids.length) throw new CliError('NOT_FOUND', `Taxonomy entry "${query}" not found`);
    }

    // efetch for taxonomy returns XML
    const xmlData = await ctx.fetchXml(buildEutilsUrl('efetch.fcgi', {
      db: 'taxonomy', id: ids.join(','), retmode: 'xml',
    })) as Record<string, any>;

    // Parse taxonomy XML: TaxaSet > Taxon
    const taxaSet = xmlData?.TaxaSet?.Taxon;
    const taxa = Array.isArray(taxaSet) ? taxaSet : taxaSet ? [taxaSet] : [];

    return taxa.map((taxon: any) => ({
      taxId: String(taxon?.TaxId ?? ''),
      name: String(taxon?.ScientificName ?? ''),
      commonName: String(taxon?.OtherNames?.CommonName ?? taxon?.OtherNames?.GenbankCommonName ?? ''),
      rank: String(taxon?.Rank ?? ''),
      division: String(taxon?.Division ?? ''),
      lineage: String(taxon?.Lineage ?? '').split('; ').slice(-4).join(' > '),
    }));
  },
});
