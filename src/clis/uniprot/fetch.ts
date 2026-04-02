/**
 * uniprot/fetch — Fetch a UniProt entry by accession.
 *
 * Returns detailed protein information including function, GO terms,
 * subcellular location, domains, and cross-references.
 */

import { cli, Strategy } from '../../registry.js';
import { CliError } from '../../errors.js';
import { buildUniprotUrl } from '../../databases/uniprot.js';

cli({
  site: 'uniprot',
  name: 'fetch',
  description: 'Get UniProt protein details by accession',
  database: 'uniprot',
  strategy: Strategy.PUBLIC,
  args: [
    { name: 'accession', positional: true, required: true, help: 'UniProt accession (e.g. P04637)' },
  ],
  columns: ['accession', 'gene', 'protein', 'organism', 'function', 'subcellularLocation', 'goTerms', 'domains'],
  func: async (ctx, args) => {
    const accession = String(args.accession).trim().toUpperCase();

    const entry = await ctx.fetchJson(
      buildUniprotUrl(`/uniprotkb/${accession}`, { format: 'json' }),
    ) as Record<string, unknown>;

    if (!entry || !entry.primaryAccession) {
      throw new CliError('NOT_FOUND', `UniProt entry ${accession} not found`, 'Check the accession is correct');
    }

    // Extract gene name
    const genes = entry.genes as Record<string, unknown>[] | undefined;
    const primaryGene = genes?.[0] as Record<string, unknown> | undefined;
    const geneName = primaryGene?.geneName as Record<string, unknown> | undefined;

    // Extract protein name
    const proteinDesc = entry.proteinDescription as Record<string, unknown> | undefined;
    const recName = proteinDesc?.recommendedName as Record<string, unknown> | undefined;
    const fullName = recName?.fullName as Record<string, unknown> | undefined;

    // Extract organism
    const org = entry.organism as Record<string, unknown> | undefined;

    // Extract function from comments
    const comments = (entry.comments ?? []) as Record<string, unknown>[];
    const functionComment = comments.find(c => c.commentType === 'FUNCTION');
    const functionTexts = (functionComment?.texts ?? []) as Record<string, unknown>[];
    const functionText = functionTexts.map(t => String(t.value ?? '')).join(' ');

    // Extract subcellular location
    const locComment = comments.find(c => c.commentType === 'SUBCELLULAR LOCATION');
    const locNote = locComment?.subcellularLocations as Record<string, unknown>[] | undefined;
    const locations = (locNote ?? []).map(l => {
      const loc = l.location as Record<string, unknown> | undefined;
      return String(loc?.value ?? '');
    }).filter(Boolean);

    // Extract GO terms from cross-references
    const xrefs = (entry.uniProtKBCrossReferences ?? []) as Record<string, unknown>[];
    const goTerms = xrefs
      .filter(x => x.database === 'GO')
      .map(x => {
        const props = (x.properties ?? []) as Record<string, unknown>[];
        const termProp = props.find(p => p.key === 'GoTerm');
        const term = String(termProp?.value ?? '');
        // GO terms are formatted as "C:nucleus" or "F:DNA binding" or "P:apoptosis"
        const [aspect, name] = term.includes(':') ? [term[0], term.slice(2)] : ['', term];
        const aspectMap: Record<string, string> = { C: 'CC', F: 'MF', P: 'BP' };
        return `${aspectMap[aspect] ?? aspect}:${name}`;
      });

    // Extract domains from features
    const features = (entry.features ?? []) as Record<string, unknown>[];
    const domains = features
      .filter(f => f.type === 'Domain')
      .map(f => {
        const loc = f.location as Record<string, unknown> | undefined;
        const start = (loc?.start as Record<string, unknown>)?.value ?? '';
        const end = (loc?.end as Record<string, unknown>)?.value ?? '';
        return `${f.description ?? ''}(${start}-${end})`;
      });

    return [{
      accession: String(entry.primaryAccession),
      gene: String(geneName?.value ?? ''),
      protein: String(fullName?.value ?? ''),
      organism: String(org?.scientificName ?? ''),
      function: functionText,
      subcellularLocation: locations.join(', '),
      goTerms: goTerms.join('; '),
      domains: domains.join('; '),
    }];
  },
});
