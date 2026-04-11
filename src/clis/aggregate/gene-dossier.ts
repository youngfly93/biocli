/**
 * aggregate/gene-dossier — Comprehensive gene intelligence report.
 *
 * Builds on gene-profile and adds:
 *   - Recent PubMed literature (top papers)
 *   - ClinVar clinical significance
 *   - Summary assessment for agent consumption
 *
 * This is the highest-level gene command — a complete "dossier" that
 * an AI agent can use to understand a gene's biological role, clinical
 * relevance, and research landscape in one call.
 */

import { cli, Strategy } from '../../registry.js';
import { CliError } from '../../errors.js';
import { wrapResult, type BiocliProvenanceOverride } from '../../types.js';
import { createHttpContextForDatabase } from '../../databases/index.js';
import { buildEutilsUrl } from '../../databases/ncbi.js';
import { parsePubmedArticles } from '../_shared/xml-helpers.js';
import { buildUniprotUrl } from '../../databases/uniprot.js';
import { buildKeggUrl, parseKeggTsv } from '../../databases/kegg.js';
import { buildStringUrl } from '../../databases/string-db.js';
import { allSettledWithProgress, reportProgress } from '../../progress.js';
import { parseGeneSummaries } from '../_shared/xml-helpers.js';
import { resolveOrganism } from '../_shared/organism-db.js';
import type { HttpContext } from '../../types.js';

// Reuse the gene-profile building blocks but add literature + clinical layers

async function fetchRecentLiterature(ctx: HttpContext, symbol: string, limit: number): Promise<
  Array<{ pmid: string; title: string; authors: string; journal: string; year: string; doi: string }>
> {
  // Search PubMed for recent papers about this gene
  const searchResult = await ctx.fetchJson(buildEutilsUrl('esearch.fcgi', {
    db: 'pubmed',
    term: `${symbol} AND "last 5 years"[PDat]`,
    retmax: String(limit),
    sort: 'relevance',
    retmode: 'json',
  })) as Record<string, unknown>;

  const esearch = searchResult?.esearchresult as Record<string, unknown> | undefined;
  const pmids: string[] = (esearch?.idlist as string[] | undefined) ?? [];
  if (!pmids.length) return [];

  const xmlData = await ctx.fetchXml(buildEutilsUrl('efetch.fcgi', {
    db: 'pubmed',
    id: pmids.join(','),
    rettype: 'xml',
  }));

  const articles = parsePubmedArticles(xmlData);
  return articles.map(a => ({
    pmid: a.pmid,
    title: a.title,
    authors: a.authors,
    journal: a.journal,
    year: a.year,
    doi: a.doi,
  }));
}

async function fetchClinvarSignificance(ctx: HttpContext, symbol: string): Promise<
  Array<{ title: string; significance: string; condition: string; accession: string }>
> {
  const searchResult = await ctx.fetchJson(buildEutilsUrl('esearch.fcgi', {
    db: 'clinvar',
    term: `${symbol}[Gene Name]`,
    retmax: '10',
    retmode: 'json',
  })) as Record<string, unknown>;

  const ids: string[] = (searchResult?.esearchresult as Record<string, unknown>)?.idlist as string[] ?? [];
  if (!ids.length) return [];

  const summary = await ctx.fetchJson(buildEutilsUrl('esummary.fcgi', {
    db: 'clinvar',
    id: ids.join(','),
    retmode: 'json',
  })) as Record<string, unknown>;

  const resultObj = summary?.result as Record<string, unknown> | undefined;
  const uids: string[] = (resultObj?.uids as string[] | undefined) ?? [];

  return uids.map(uid => {
    const item = (resultObj?.[uid] ?? {}) as Record<string, unknown>;
    // NCBI renamed ClinVar esummary fields in 2024/2025:
    //   clinical_significance → germline_classification.description
    //   trait_set (top-level) → germline_classification.trait_set
    // Fall back to legacy field names for compatibility.
    const germline = (item.germline_classification ?? {}) as Record<string, unknown>;
    const sig = String(
      germline.description
      ?? (typeof item.clinical_significance === 'object'
        ? (item.clinical_significance as Record<string, unknown>)?.description ?? ''
        : item.clinical_significance ?? '')
    );
    const traitSet = (germline.trait_set ?? item.trait_set) as Record<string, unknown>[] | undefined;
    const traits = Array.isArray(traitSet)
      ? traitSet.map(t => String(t.trait_name ?? '')).join('; ')
      : '';
    return {
      title: String(item.title ?? ''),
      significance: sig,
      condition: traits,
      accession: String(item.accession ?? ''),
    };
  });
}

export interface GeneDossierData {
  symbol: string;
  name: string;
  summary: string;
  function: string;
  chromosome: string;
  location: string;
  pathways: Array<{ id: string; name: string }>;
  goTerms: Array<{ id: string; name: string; aspect: string }>;
  interactions: Array<{ partner: string; score: number }>;
  recentLiterature: Array<{ pmid: string; title: string; authors: string; journal: string; year: string; doi: string }>;
  clinicalVariants: Array<{ title: string; significance: string; condition: string; accession: string }>;
}

export interface GeneDossierBuildResult {
  data: GeneDossierData;
  ids: Record<string, string>;
  sources: string[];
  warnings: string[];
  organism: string;
  provenance: BiocliProvenanceOverride[];
}

export async function buildGeneDossier(
  geneArg: string,
  organismArg: string,
  papersArg: number,
): Promise<GeneDossierBuildResult> {
  const symbol = String(geneArg).trim();
  if (!symbol) throw new CliError('ARGUMENT', 'Gene symbol is required');

  const org = resolveOrganism(String(organismArg));
  const paperCount = Math.max(1, Math.min(Number(papersArg), 20));

  const sources: string[] = [];
  const warnings: string[] = [];
  const ids: Record<string, string> = {};

  const ncbiCtx = createHttpContextForDatabase('ncbi');
  const uniprotCtx = createHttpContextForDatabase('uniprot');
  const keggCtx = createHttpContextForDatabase('kegg');
  const stringCtx = createHttpContextForDatabase('string');

  // Phase 1: Core profile (parallel)
  const [ncbiResult, uniprotResult, stringResult, litResult, clinvarResult] = await allSettledWithProgress(
    'Waiting on',
    [
      {
        label: 'NCBI Gene',
        task: async () => {
          const sr = await ncbiCtx.fetchJson(buildEutilsUrl('esearch.fcgi', {
            db: 'gene', term: `${symbol}[Gene Name] AND ${org.name}[Organism]`,
            retmax: '5', retmode: 'json',
          })) as Record<string, unknown>;
          const gids: string[] = (sr?.esearchresult as Record<string, unknown>)?.idlist as string[] ?? [];
          if (!gids.length) return null;
          const summ = await ncbiCtx.fetchJson(buildEutilsUrl('esummary.fcgi', {
            db: 'gene', id: gids.join(','), retmode: 'json',
          }));
          const genes = parseGeneSummaries(summ);
          const best = genes.find(g => g.symbol.toUpperCase() === symbol.toUpperCase()) ?? genes[0];
          return best ?? null;
        },
      },
      {
        label: 'UniProt',
        task: async () => {
          const data = await uniprotCtx.fetchJson(buildUniprotUrl('/uniprotkb/search', {
            query: `gene:${symbol} AND organism_id:${org.taxId} AND reviewed:true`,
            format: 'json', size: '1',
          })) as Record<string, unknown>;
          const results = (data?.results ?? []) as Record<string, unknown>[];
          return results[0] ?? null;
        },
      },
      {
        label: 'STRING',
        task: async () => {
          const data = await stringCtx.fetchJson(buildStringUrl('interaction_partners', {
            identifiers: symbol, species: String(org.taxId), limit: '10', required_score: '400',
          })) as Record<string, unknown>[];
          return Array.isArray(data) ? data.map(i => ({
            partner: String(i.preferredName_B ?? ''),
            score: Number(i.score ?? 0),
          })) : [];
        },
      },
      { label: 'PubMed', task: () => fetchRecentLiterature(ncbiCtx, symbol, paperCount) },
      { label: 'ClinVar', task: () => fetchClinvarSignificance(ncbiCtx, symbol) },
    ],
  );

  // Extract NCBI
  let ncbiGene: Record<string, string> | null = null;
  if (ncbiResult.status === 'fulfilled' && ncbiResult.value) {
    ncbiGene = ncbiResult.value as unknown as Record<string, string>;
    sources.push('NCBI Gene');
    ids.ncbiGeneId = String(ncbiGene.geneId);
  } else {
    warnings.push(`NCBI Gene: ${ncbiResult.status === 'rejected' ? ncbiResult.reason : 'not found'}`);
  }

  // Extract UniProt (function + GO terms)
  let uniprotFunc = '';
  let goTerms: Array<{ id: string; name: string; aspect: string }> = [];
  if (uniprotResult.status === 'fulfilled' && uniprotResult.value) {
    const entry = uniprotResult.value as Record<string, unknown>;
    ids.uniprotAccession = String(entry.primaryAccession ?? '');
    const comments = (entry.comments ?? []) as Record<string, unknown>[];
    const fc = comments.find(c => c.commentType === 'FUNCTION');
    const texts = (fc?.texts ?? []) as Record<string, unknown>[];
    uniprotFunc = texts.map(t => String(t.value ?? '')).join(' ');

    // Extract GO terms from cross-references
    const xrefs = (entry.uniProtKBCrossReferences ?? []) as Record<string, unknown>[];
    goTerms = xrefs
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

    sources.push('UniProt');
  } else {
    warnings.push(`UniProt: ${uniprotResult.status === 'rejected' ? uniprotResult.reason : 'not found'}`);
  }

  // Extract STRING
  const interactions = stringResult.status === 'fulfilled' ? stringResult.value : [];
  if (interactions.length) sources.push('STRING');

  // Extract literature
  const literature = litResult.status === 'fulfilled' ? litResult.value : [];
  if (literature.length) sources.push('PubMed');
  else warnings.push(`PubMed: ${litResult.status === 'rejected' ? litResult.reason : 'no recent papers'}`);

  // Extract ClinVar
  const clinvar = clinvarResult.status === 'fulfilled' ? clinvarResult.value : [];
  if (clinvar.length) sources.push('ClinVar');

  // KEGG pathways (sequential, needs gene ID)
  let pathways: Array<{ id: string; name: string }> = [];
  if (ncbiGene?.geneId) {
    try {
      reportProgress('Querying KEGG pathways…');
      const keggId = `${org.keggOrg}:${ncbiGene.geneId}`;
      const pathText = await keggCtx.fetchText(buildKeggUrl(`/link/pathway/${keggId}`));
      if (pathText.trim()) {
        const links = parseKeggTsv(pathText);
        const pathIds = links.map(l => l.value.replace(/^path:/, '')).filter(Boolean);
        const listText = await keggCtx.fetchText(buildKeggUrl(`/list/pathway/${org.keggOrg}`));
        const pathMap = new Map(parseKeggTsv(listText).map(p => [p.key, p.value.replace(/ - .*$/, '')]));
        pathways = pathIds.map(id => ({ id, name: pathMap.get(id) ?? id }));
        ids.keggId = keggId;
        sources.push('KEGG');
      }
    } catch (err) {
      warnings.push(`KEGG: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return {
    data: {
      symbol,
      name: String(ncbiGene?.name ?? ''),
      summary: String(ncbiGene?.summary ?? ''),
      function: uniprotFunc,
      chromosome: String(ncbiGene?.chromosome ?? ''),
      location: String(ncbiGene?.location ?? ''),
      pathways,
      goTerms,
      interactions,
      recentLiterature: literature,
      clinicalVariants: clinvar,
    },
    ids,
    sources,
    warnings,
    organism: org.name,
    provenance: [
      ...(literature.length > 0 ? [{
        source: 'PubMed',
        recordIds: literature.map(item => item.pmid),
      }] : []),
      ...(clinvar.length > 0 ? [{
        source: 'ClinVar',
        recordIds: clinvar.map(item => item.accession),
      }] : []),
    ],
  };
}

cli({
  site: 'aggregate',
  name: 'gene-dossier',
  description: 'Complete gene intelligence report (profile + literature + clinical)',
  database: 'aggregate',
  strategy: Strategy.PUBLIC,
  defaultFormat: 'json',
  timeoutSeconds: 90,
  args: [
    { name: 'gene', positional: true, required: true, help: 'Gene symbol (e.g. TP53)' },
    { name: 'organism', default: 'human', help: 'Organism (e.g. human, mouse)' },
    { name: 'papers', type: 'int', default: 5, help: 'Number of recent papers to include' },
  ],
  examples: [
    {
      goal: 'Assemble a gene intelligence dossier for TP53',
      command: 'biocli aggregate gene-dossier TP53 --organism human --papers 5 -f json',
    },
    {
      goal: 'Get a mouse-focused dossier with fewer literature hits',
      command: 'biocli aggregate gene-dossier Trp53 --organism mouse --papers 3 -f json',
    },
  ],
  whenToUse: 'Use when you need a higher-level gene briefing that combines baseline biology with recent literature and clinical context.',
  columns: ['symbol', 'name', 'pathways', 'interactions', 'literature', 'clinvar'],
  func: async (_ctx, args) => {
    const built = await buildGeneDossier(String(args.gene), String(args.organism), Number(args.papers));
    return wrapResult(built.data, {
      ids: built.ids,
      sources: built.sources,
      warnings: built.warnings,
      organism: built.organism,
      query: built.data.symbol,
      provenance: built.provenance,
    });
  },
});
