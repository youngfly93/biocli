/**
 * uniprot/search — Search UniProt KB by gene name, protein name, or keyword.
 *
 * Uses the UniProt REST API search endpoint with JSON output.
 */

import { cli, Strategy } from '../../registry.js';
import { CliError } from '../../errors.js';
import { buildUniprotUrl } from '../../databases/uniprot.js';
import { withMeta } from '../../types.js';

cli({
  site: 'uniprot',
  name: 'search',
  description: 'Search UniProt proteins',
  database: 'uniprot',
  strategy: Strategy.PUBLIC,
  args: [
    { name: 'query', positional: true, required: true, help: 'Search query (e.g. "TP53", "kinase human")' },
    { name: 'limit', type: 'int', default: 10, help: 'Max results (1-100)' },
    { name: 'organism', default: '9606', help: 'Organism taxonomy ID (default: 9606 for human)' },
    { name: 'reviewed', default: 'true', help: 'Only Swiss-Prot reviewed entries (true/false)' },
  ],
  columns: ['accession', 'gene', 'protein', 'organism', 'length', 'reviewed'],
  func: async (ctx, args) => {
    const limit = Math.max(1, Math.min(Number(args.limit), 100));
    const query = String(args.query);
    const organism = String(args.organism);
    const reviewed = String(args.reviewed) !== 'false';

    // Build UniProt search query
    let searchQuery = query;
    if (organism && organism !== 'all') {
      searchQuery += ` AND organism_id:${organism}`;
    }
    if (reviewed) {
      searchQuery += ' AND reviewed:true';
    }

    const data = await ctx.fetchJson(buildUniprotUrl('/uniprotkb/search', {
      query: searchQuery,
      format: 'json',
      size: String(limit),
      fields: 'accession,gene_names,protein_name,organism_name,length,reviewed',
    })) as Record<string, unknown>;

    const results = (data?.results ?? []) as Record<string, unknown>[];
    if (!results.length) {
      throw new CliError('NOT_FOUND', `No UniProt entries found for "${query}"`, 'Try a different search term or set --organism all');
    }

    const rows = results.map(entry => {
      const genes = entry.genes as Record<string, unknown>[] | undefined;
      const primaryGene = genes?.[0] as Record<string, unknown> | undefined;
      const geneName = primaryGene?.geneName as Record<string, unknown> | undefined;

      const proteinDesc = entry.proteinDescription as Record<string, unknown> | undefined;
      const recName = proteinDesc?.recommendedName as Record<string, unknown> | undefined;
      const fullName = recName?.fullName as Record<string, unknown> | undefined;

      const org = entry.organism as Record<string, unknown> | undefined;

      return {
        accession: String(entry.primaryAccession ?? ''),
        gene: String(geneName?.value ?? ''),
        protein: String(fullName?.value ?? ''),
        organism: String(org?.scientificName ?? ''),
        length: Number(entry.sequence && (entry.sequence as Record<string, unknown>).length || 0),
        reviewed: entry.entryType === 'UniProtKB reviewed (Swiss-Prot)' ? 'yes' : 'no',
      };
    });

    return withMeta(rows, { totalCount: Number(data?.totalCount ?? rows.length), query });
  },
});
