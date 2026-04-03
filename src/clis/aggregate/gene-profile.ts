/**
 * aggregate/gene-profile — Complete gene profile from multiple databases.
 *
 * THE KILLER FEATURE: one command queries NCBI Gene, UniProt, KEGG, and
 * STRING in parallel and returns a unified, agent-friendly JSON object.
 *
 * Supports:
 *   - Single gene:  biocli aggregate gene-profile TP53
 *   - Batch:        biocli aggregate gene-profile TP53,BRCA1,EGFR
 *
 * Design:
 *   - Promise.allSettled for partial failure tolerance
 *   - _meta.sources tracks which databases contributed
 *   - _meta.errors reports partial failures without crashing
 */

import { cli, Strategy } from '../../registry.js';
import { CliError } from '../../errors.js';
import { wrapResult } from '../../types.js';
import { createHttpContextForDatabase } from '../../databases/index.js';
import { buildEutilsUrl } from '../../databases/ncbi.js';
import { buildUniprotUrl } from '../../databases/uniprot.js';
import { buildKeggUrl, parseKeggTsv, parseKeggEntry } from '../../databases/kegg.js';
import { buildStringUrl } from '../../databases/string-db.js';
import { parseGeneSummaries } from '../_shared/xml-helpers.js';
import { resolveOrganism } from '../_shared/organism-db.js';
import type { HttpContext } from '../../types.js';

// ── Types ─────────────────────────────────────────────────────────────────────

interface GeneProfileData {
  symbol: string;
  name: string;
  summary: string;
  chromosome: string;
  location: string;
  function: string;
  subcellularLocation: string;
  pathways: Array<{ id: string; name: string; source: string }>;
  goTerms: Array<{ id: string; name: string; aspect: string }>;
  interactions: Array<{ partner: string; score: number }>;
  diseases: Array<{ id: string; name: string; source: string }>;
}

// ── NCBI Gene fetch ───────────────────────────────────────────────────────────

async function fetchNcbiGene(ctx: HttpContext, symbol: string, organism: string): Promise<{
  geneId: string; name: string; summary: string; chromosome: string; location: string;
} | null> {
  // Fetch top 5 candidates to detect ambiguity
  const searchResult = await ctx.fetchJson(buildEutilsUrl('esearch.fcgi', {
    db: 'gene', term: `${symbol}[Gene Name] AND ${organism}[Organism]`,
    retmax: '5', retmode: 'json',
  })) as Record<string, unknown>;

  const ids: string[] = (searchResult?.esearchresult as Record<string, unknown>)?.idlist as string[] ?? [];
  if (!ids.length) return null;

  const summaryResult = await ctx.fetchJson(buildEutilsUrl('esummary.fcgi', {
    db: 'gene', id: ids.join(','), retmode: 'json',
  }));

  const genes = parseGeneSummaries(summaryResult);
  if (!genes.length) return null;

  // Prefer exact symbol match to avoid returning a wrong gene
  const exactMatch = genes.find(g => g.symbol.toUpperCase() === symbol.toUpperCase());
  const best = exactMatch ?? genes[0];

  return {
    geneId: best.geneId,
    name: best.name,
    summary: best.summary,
    chromosome: best.chromosome,
    location: best.location,
  };
}

// ── UniProt fetch ─────────────────────────────────────────────────────────────

async function fetchUniprotData(ctx: HttpContext, symbol: string, taxId: number): Promise<{
  accession: string; function: string; subcellularLocation: string;
  goTerms: Array<{ id: string; name: string; aspect: string }>;
  ensemblGeneId?: string;
} | null> {
  // Fetch top 5 and pick the exact gene name match
  const query = `gene:${symbol} AND organism_id:${taxId} AND reviewed:true`;
  const data = await ctx.fetchJson(buildUniprotUrl('/uniprotkb/search', {
    query, format: 'json', size: '5',
  })) as Record<string, unknown>;

  const results = (data?.results ?? []) as Record<string, unknown>[];
  if (!results.length) return null;

  // Find exact gene name match among candidates
  const getGeneName = (e: Record<string, unknown>): string => {
    const genes = e.genes as Record<string, unknown>[] | undefined;
    const primary = genes?.[0] as Record<string, unknown> | undefined;
    const gn = primary?.geneName as Record<string, unknown> | undefined;
    return String(gn?.value ?? '');
  };

  const exactMatch = results.find(e => getGeneName(e).toUpperCase() === symbol.toUpperCase());
  const entry = exactMatch ?? results[0];
  const accession = String(entry.primaryAccession ?? '');

  // Function
  const comments = (entry.comments ?? []) as Record<string, unknown>[];
  const funcComment = comments.find(c => c.commentType === 'FUNCTION');
  const funcTexts = (funcComment?.texts ?? []) as Record<string, unknown>[];
  const funcText = funcTexts.map(t => String(t.value ?? '')).join(' ');

  // Subcellular location
  const locComment = comments.find(c => c.commentType === 'SUBCELLULAR LOCATION');
  const locEntries = (locComment?.subcellularLocations ?? []) as Record<string, unknown>[];
  const locations = locEntries.map(l => String((l.location as Record<string, unknown>)?.value ?? '')).filter(Boolean);

  // GO terms
  const xrefs = (entry.uniProtKBCrossReferences ?? []) as Record<string, unknown>[];
  const goTerms = xrefs
    .filter(x => x.database === 'GO')
    .map(x => {
      const id = String(x.id ?? '');
      const props = (x.properties ?? []) as Record<string, unknown>[];
      const termProp = props.find(p => p.key === 'GoTerm');
      const term = String(termProp?.value ?? '');
      const aspectMap: Record<string, string> = { C: 'CC', F: 'MF', P: 'BP' };
      const [aspect, ...nameParts] = term.split(':');
      return { id, name: nameParts.join(':'), aspect: aspectMap[aspect] ?? aspect };
    });

  // Ensembl cross-ref
  const ensemblXref = xrefs.find(x => x.database === 'Ensembl');
  const ensemblProps = (ensemblXref?.properties ?? []) as Record<string, unknown>[];
  const ensemblGeneProp = ensemblProps.find(p => p.key === 'GeneId');
  const ensemblGeneId = ensemblGeneProp ? String(ensemblGeneProp.value) : undefined;

  return {
    accession,
    function: funcText,
    subcellularLocation: locations.join(', '),
    goTerms,
    ensemblGeneId,
  };
}

// ── KEGG fetch ────────────────────────────────────────────────────────────────

/**
 * Normalize KEGG pathway IDs: /link/pathway returns "path:hsa04115"
 * but /list/pathway returns "hsa04115". Strip the "path:" prefix.
 */
function normalizeKeggId(id: string): string {
  return id.replace(/^path:/, '');
}

async function fetchKeggData(
  ctx: HttpContext,
  keggOrg: string,
  geneId: string,
  errors: string[],
): Promise<{
  keggId: string;
  pathways: Array<{ id: string; name: string }>;
  diseases: Array<{ id: string; name: string }>;
}> {
  const keggId = `${keggOrg}:${geneId}`;

  // Fetch pathways with name resolution
  let pathways: Array<{ id: string; name: string }> = [];
  try {
    const pathText = await ctx.fetchText(buildKeggUrl(`/link/pathway/${keggId}`));
    if (pathText.trim()) {
      const links = parseKeggTsv(pathText);
      const pathIds = links.map(l => l.value).filter(Boolean);
      if (pathIds.length) {
        // /list/pathway/hsa returns "hsa04115\tPathway name - Homo sapiens (human)"
        const listText = await ctx.fetchText(buildKeggUrl(`/list/pathway/${keggOrg}`));
        const allPaths = parseKeggTsv(listText);
        const pathMap = new Map(allPaths.map(p => [p.key, p.value.replace(/ - .*$/, '')]));
        pathways = pathIds.map(rawId => {
          const normalized = normalizeKeggId(rawId);
          return { id: normalized, name: pathMap.get(normalized) ?? normalized };
        });
      }
    }
  } catch (err) {
    errors.push(`KEGG pathways: ${err instanceof Error ? err.message : String(err)}`);
  }

  // Fetch diseases with name resolution (reuse kegg/disease.ts pattern)
  let diseases: Array<{ id: string; name: string }> = [];
  try {
    const diseaseText = await ctx.fetchText(buildKeggUrl(`/link/disease/${keggId}`));
    if (diseaseText.trim()) {
      const links = parseKeggTsv(diseaseText);
      const diseaseIds = links.map(l => l.value).filter(Boolean);

      // Batch name resolution: /get accepts up to 10 IDs joined with '+'
      const names: Record<string, string> = {};
      for (let i = 0; i < diseaseIds.length; i += 10) {
        const batch = diseaseIds.slice(i, i + 10);
        try {
          const text = await ctx.fetchText(buildKeggUrl(`/get/${batch.join('+')}`));
          for (const entryText of text.split('///').filter(e => e.trim())) {
            const parsed = parseKeggEntry(entryText);
            if (parsed.ENTRY && parsed.NAME) {
              const id = 'ds:' + parsed.ENTRY.split(/\s+/)[0];
              names[id] = parsed.NAME;
            }
          }
        } catch (err) {
          errors.push(`KEGG disease names (batch ${i / 10 + 1}): ${err instanceof Error ? err.message : String(err)}`);
        }
      }

      diseases = diseaseIds.map(id => ({ id, name: names[id] ?? '' }));
    }
  } catch (err) {
    errors.push(`KEGG diseases: ${err instanceof Error ? err.message : String(err)}`);
  }

  return { keggId, pathways, diseases };
}

// ── STRING fetch ──────────────────────────────────────────────────────────────

async function fetchStringPartners(ctx: HttpContext, symbol: string, taxId: number): Promise<
  Array<{ partner: string; score: number }>
> {
  // Let errors propagate — Promise.allSettled in the caller handles them
  const data = await ctx.fetchJson(buildStringUrl('interaction_partners', {
    identifiers: symbol,
    species: String(taxId),
    limit: '10',
    required_score: '400',
  })) as Record<string, unknown>[];

  if (!Array.isArray(data)) return [];

  return data.map(item => ({
    partner: String(item.preferredName_B ?? ''),
    score: Number(item.score ?? 0),
  }));
}

// ── Main command ──────────────────────────────────────────────────────────────

async function buildGeneProfile(
  symbol: string,
  organismName: string,
  taxId: number,
  keggOrg: string,
): Promise<ReturnType<typeof wrapResult>> {
  const meta = { sources: [] as string[], queriedAt: new Date().toISOString(), errors: [] as string[] };

  const ncbiCtx = createHttpContextForDatabase('ncbi');
  const uniprotCtx = createHttpContextForDatabase('uniprot');
  const keggCtx = createHttpContextForDatabase('kegg');
  const stringCtx = createHttpContextForDatabase('string');

  // Parallel queries with partial failure tolerance
  const [ncbiResult, uniprotResult, stringResult] = await Promise.allSettled([
    fetchNcbiGene(ncbiCtx, symbol, organismName),
    fetchUniprotData(uniprotCtx, symbol, taxId),
    fetchStringPartners(stringCtx, symbol, taxId),
  ]);

  // Extract NCBI data
  let ncbiData: Awaited<ReturnType<typeof fetchNcbiGene>> = null;
  if (ncbiResult.status === 'fulfilled' && ncbiResult.value) {
    ncbiData = ncbiResult.value;
    meta.sources.push('NCBI Gene');
  } else {
    meta.errors.push(`NCBI: ${ncbiResult.status === 'rejected' ? ncbiResult.reason : 'no data'}`);
  }

  // Extract UniProt data
  let uniprotData: Awaited<ReturnType<typeof fetchUniprotData>> = null;
  if (uniprotResult.status === 'fulfilled' && uniprotResult.value) {
    uniprotData = uniprotResult.value;
    meta.sources.push('UniProt');
  } else {
    meta.errors.push(`UniProt: ${uniprotResult.status === 'rejected' ? uniprotResult.reason : 'no data'}`);
  }

  // Extract STRING data
  let interactions: Array<{ partner: string; score: number }> = [];
  if (stringResult.status === 'fulfilled' && stringResult.value.length) {
    interactions = stringResult.value;
    meta.sources.push('STRING');
  } else {
    meta.errors.push(`STRING: ${stringResult.status === 'rejected' ? stringResult.reason : 'no data'}`);
  }

  // KEGG (needs NCBI Gene ID first, so sequential)
  // Errors are pushed to meta.errors inside fetchKeggData, not silently swallowed
  let keggData: Awaited<ReturnType<typeof fetchKeggData>> | null = null;
  if (ncbiData?.geneId) {
    try {
      keggData = await fetchKeggData(keggCtx, keggOrg, ncbiData.geneId, meta.errors);
      if (keggData.pathways.length || keggData.diseases.length) {
        meta.sources.push('KEGG');
      }
    } catch (err) {
      meta.errors.push(`KEGG: ${err instanceof Error ? err.message : String(err)}`);
    }
  } else {
    meta.errors.push('KEGG: skipped (no NCBI Gene ID to map from)');
  }

  const profileData: GeneProfileData = {
    symbol,
    name: ncbiData?.name ?? '',
    summary: ncbiData?.summary ?? '',
    chromosome: ncbiData?.chromosome ?? '',
    location: ncbiData?.location ?? '',
    function: uniprotData?.function ?? '',
    subcellularLocation: uniprotData?.subcellularLocation ?? '',
    pathways: (keggData?.pathways ?? []).map(p => ({ ...p, source: 'KEGG' })),
    goTerms: uniprotData?.goTerms ?? [],
    interactions,
    diseases: (keggData?.diseases ?? []).map(d => ({ ...d, source: 'KEGG' })),
  };

  const ids: Record<string, string> = {};
  if (ncbiData?.geneId) ids.ncbiGeneId = ncbiData.geneId;
  if (uniprotData?.accession) ids.uniprotAccession = uniprotData.accession;
  if (keggData?.keggId) ids.keggId = keggData.keggId;
  if (uniprotData?.ensemblGeneId) ids.ensemblGeneId = uniprotData.ensemblGeneId;

  return wrapResult(profileData, {
    ids,
    sources: meta.sources,
    warnings: meta.errors,
    organism: organismName,
    query: symbol,
  });
}

cli({
  site: 'aggregate',
  name: 'gene-profile',
  description: 'Complete gene profile from NCBI + UniProt + KEGG + STRING',
  database: 'aggregate',
  strategy: Strategy.PUBLIC,
  defaultFormat: 'json',
  timeoutSeconds: 60,
  args: [
    { name: 'genes', positional: true, required: true, help: 'Gene symbol(s), comma-separated (e.g. TP53 or TP53,BRCA1,EGFR)' },
    { name: 'organism', default: 'human', help: 'Organism (e.g. human, mouse, 9606)' },
  ],
  columns: ['symbol', 'name', 'organism', 'pathways', 'goTerms', 'interactions'],
  func: async (_ctx, args) => {
    const genes = String(args.genes).split(',').map(s => s.trim()).filter(Boolean);
    if (!genes.length) {
      throw new CliError('ARGUMENT', 'At least one gene symbol is required');
    }

    const org = resolveOrganism(String(args.organism));

    if (genes.length === 1) {
      return await buildGeneProfile(genes[0], org.name, org.taxId, org.keggOrg);
    }

    // Batch: process genes sequentially to respect rate limits
    const profiles = [];
    for (const gene of genes) {
      profiles.push(await buildGeneProfile(gene, org.name, org.taxId, org.keggOrg));
    }
    return profiles;
  },
});
