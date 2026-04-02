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
import { createHttpContextForDatabase } from '../../databases/index.js';
import { buildEutilsUrl } from '../../databases/ncbi.js';
import { buildUniprotUrl } from '../../databases/uniprot.js';
import { buildKeggUrl, parseKeggTsv } from '../../databases/kegg.js';
import { buildStringUrl } from '../../databases/string-db.js';
import { parseGeneSummaries } from '../_shared/xml-helpers.js';
import { resolveOrganism } from '../_shared/organism-db.js';
import type { HttpContext } from '../../types.js';

// ── Types ─────────────────────────────────────────────────────────────────────

interface GeneProfile {
  symbol: string;
  name: string;
  organism: string;
  ids: {
    ncbiGeneId?: string;
    uniprotAccession?: string;
    keggId?: string;
    ensemblGeneId?: string;
  };
  summary: string;
  chromosome: string;
  location: string;
  function: string;
  subcellularLocation: string;
  pathways: Array<{ id: string; name: string; source: string }>;
  goTerms: Array<{ id: string; name: string; aspect: string }>;
  interactions: Array<{ partner: string; score: number }>;
  diseases: Array<{ id: string; name: string; source: string }>;
  _meta: {
    sources: string[];
    queriedAt: string;
    errors: string[];
  };
}

// ── NCBI Gene fetch ───────────────────────────────────────────────────────────

async function fetchNcbiGene(ctx: HttpContext, symbol: string, organism: string): Promise<{
  geneId: string; name: string; summary: string; chromosome: string; location: string;
} | null> {
  const searchResult = await ctx.fetchJson(buildEutilsUrl('esearch.fcgi', {
    db: 'gene', term: `${symbol}[Gene Name] AND ${organism}[Organism]`,
    retmax: '1', retmode: 'json',
  })) as Record<string, unknown>;

  const ids: string[] = (searchResult?.esearchresult as Record<string, unknown>)?.idlist as string[] ?? [];
  if (!ids.length) return null;

  const summaryResult = await ctx.fetchJson(buildEutilsUrl('esummary.fcgi', {
    db: 'gene', id: ids[0], retmode: 'json',
  }));

  const genes = parseGeneSummaries(summaryResult);
  if (!genes.length) return null;

  return {
    geneId: genes[0].geneId,
    name: genes[0].name,
    summary: genes[0].summary,
    chromosome: genes[0].chromosome,
    location: genes[0].location,
  };
}

// ── UniProt fetch ─────────────────────────────────────────────────────────────

async function fetchUniprotData(ctx: HttpContext, symbol: string, taxId: number): Promise<{
  accession: string; function: string; subcellularLocation: string;
  goTerms: Array<{ id: string; name: string; aspect: string }>;
  ensemblGeneId?: string;
} | null> {
  const query = `gene:${symbol} AND organism_id:${taxId} AND reviewed:true`;
  const data = await ctx.fetchJson(buildUniprotUrl('/uniprotkb/search', {
    query, format: 'json', size: '1',
  })) as Record<string, unknown>;

  const results = (data?.results ?? []) as Record<string, unknown>[];
  if (!results.length) return null;

  const entry = results[0];
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

async function fetchKeggData(ctx: HttpContext, keggOrg: string, geneId: string): Promise<{
  keggId: string;
  pathways: Array<{ id: string; name: string }>;
  diseases: Array<{ id: string; name: string }>;
} | null> {
  const keggId = `${keggOrg}:${geneId}`;

  // Fetch pathways
  let pathways: Array<{ id: string; name: string }> = [];
  try {
    const pathText = await ctx.fetchText(buildKeggUrl(`/link/pathway/${keggId}`));
    if (pathText.trim()) {
      const links = parseKeggTsv(pathText);
      // Get pathway names
      const pathIds = links.map(l => l.value).filter(Boolean);
      if (pathIds.length) {
        const listText = await ctx.fetchText(buildKeggUrl(`/list/pathway/${keggOrg}`));
        const allPaths = parseKeggTsv(listText);
        const pathMap = new Map(allPaths.map(p => [p.key, p.value.replace(/ - .*$/, '')]));
        pathways = pathIds.map(id => ({ id, name: pathMap.get(id) ?? id }));
      }
    }
  } catch { /* non-fatal */ }

  // Fetch diseases
  let diseases: Array<{ id: string; name: string }> = [];
  try {
    const diseaseText = await ctx.fetchText(buildKeggUrl(`/link/disease/${keggId}`));
    if (diseaseText.trim()) {
      const links = parseKeggTsv(diseaseText);
      diseases = links.map(l => ({ id: l.value, name: '' }));
    }
  } catch { /* non-fatal */ }

  return { keggId, pathways, diseases };
}

// ── STRING fetch ──────────────────────────────────────────────────────────────

async function fetchStringPartners(ctx: HttpContext, symbol: string, taxId: number): Promise<
  Array<{ partner: string; score: number }>
> {
  try {
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
  } catch {
    return [];
  }
}

// ── Main command ──────────────────────────────────────────────────────────────

async function buildGeneProfile(
  symbol: string,
  organismName: string,
  taxId: number,
  keggOrg: string,
): Promise<GeneProfile> {
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
  let keggData: Awaited<ReturnType<typeof fetchKeggData>> = null;
  if (ncbiData?.geneId) {
    try {
      keggData = await fetchKeggData(keggCtx, keggOrg, ncbiData.geneId);
      if (keggData) meta.sources.push('KEGG');
    } catch (err) {
      meta.errors.push(`KEGG: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return {
    symbol,
    name: ncbiData?.name ?? '',
    organism: organismName,
    ids: {
      ncbiGeneId: ncbiData?.geneId,
      uniprotAccession: uniprotData?.accession,
      keggId: keggData?.keggId,
      ensemblGeneId: uniprotData?.ensemblGeneId,
    },
    summary: ncbiData?.summary ?? '',
    chromosome: ncbiData?.chromosome ?? '',
    location: ncbiData?.location ?? '',
    function: uniprotData?.function ?? '',
    subcellularLocation: uniprotData?.subcellularLocation ?? '',
    pathways: (keggData?.pathways ?? []).map(p => ({ ...p, source: 'KEGG' })),
    goTerms: uniprotData?.goTerms ?? [],
    interactions,
    diseases: (keggData?.diseases ?? []).map(d => ({ ...d, source: 'KEGG' })),
    _meta: meta,
  };
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
      return [await buildGeneProfile(genes[0], org.name, org.taxId, org.keggOrg)];
    }

    // Batch: process genes sequentially to respect rate limits
    const profiles: GeneProfile[] = [];
    for (const gene of genes) {
      profiles.push(await buildGeneProfile(gene, org.name, org.taxId, org.keggOrg));
    }
    return profiles;
  },
});
