/**
 * aggregate/compare-genes — Compare a gene set across pathways, GO terms,
 * STRING interactions, and set-level enrichment.
 */

import { cli, Strategy } from '../../registry.js';
import { CliError } from '../../errors.js';
import { wrapResult } from '../../types.js';
import { createHttpContextForDatabase } from '../../databases/index.js';
import { buildEutilsUrl } from '../../databases/ncbi.js';
import { buildUniprotUrl } from '../../databases/uniprot.js';
import { buildKeggUrl, parseKeggTsv } from '../../databases/kegg.js';
import { buildStringUrl } from '../../databases/string-db.js';
import { submitGeneList, getEnrichment } from '../../databases/enrichr.js';
import { parseGeneSummaries } from '../_shared/xml-helpers.js';
import { resolveOrganism } from '../_shared/organism-db.js';

interface CompareGenePathway {
  pathwayId: string;
  pathwayName: string;
}

interface CompareGeneGoTerm {
  id: string;
  name: string;
  aspect: string;
}

interface CompareGeneProfile {
  symbol: string;
  ncbiGeneId?: string;
  uniprotAccession?: string;
  name?: string;
  chromosome?: string;
  function?: string;
  pathways: CompareGenePathway[];
  goTerms: CompareGeneGoTerm[];
}

interface SharedMembershipRow {
  id: string;
  name: string;
  genes: string[];
  geneCount: number;
}

interface GeneSpecificTermsRow {
  gene: string;
  aspect: string;
  terms: Array<{ id: string; name: string }>;
}

interface PairwiseOverlapRow {
  geneA: string;
  geneB: string;
  sharedPathwayCount: number;
  sharedGoTermCount: number;
  sharedPathways: string[];
  sharedGoTerms: string[];
  interactionScore?: number;
}

interface InteractionEdge {
  geneA: string;
  geneB: string;
  score: number;
  experimentalScore: number;
  databaseScore: number;
  textminingScore: number;
}

interface CompareGenesData {
  summary: {
    geneCount: number;
    sharedPathwayCount: number;
    sharedGoTermCount: number;
    interactionCount: number;
    pairwiseComparisons: number;
    goEnrichmentTerms: number;
  };
  genes: CompareGeneProfile[];
  sharedPathways: SharedMembershipRow[];
  sharedGoTerms: Array<SharedMembershipRow & { aspect: string }>;
  geneSpecificPathways: Array<{ gene: string; pathways: CompareGenePathway[] }>;
  geneSpecificGoTerms: GeneSpecificTermsRow[];
  pairwiseOverlap: PairwiseOverlapRow[];
  interactionSubnetwork: InteractionEdge[];
  goEnrichment: Array<{
    rank: number;
    term: string;
    adjustedPValue: string;
    combinedScore: number;
    genes: string[];
    source: string;
  }>;
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function normalizeGenes(raw: string): { genes: string[]; duplicateWarnings: string[] } {
  const seen = new Set<string>();
  const genes: string[] = [];
  const duplicateWarnings: string[] = [];
  for (const item of raw.split(',')) {
    const gene = item.trim();
    if (!gene) continue;
    const key = gene.toUpperCase();
    if (seen.has(key)) {
      duplicateWarnings.push(`Duplicate gene removed: ${gene}`);
      continue;
    }
    seen.add(key);
    genes.push(gene);
  }
  return { genes, duplicateWarnings };
}

function parseUniProtGoTerms(entry: Record<string, unknown>, gene: string): CompareGeneGoTerm[] {
  const xrefs = (entry.uniProtKBCrossReferences ?? []) as Record<string, unknown>[];
  const aspectMap: Record<string, string> = { C: 'CC', F: 'MF', P: 'BP' };
  const seen = new Set<string>();
  const terms: CompareGeneGoTerm[] = [];

  for (const xref of xrefs) {
    if (xref.database !== 'GO') continue;
    const id = String(xref.id ?? '');
    if (!id || seen.has(id)) continue;
    const props = (xref.properties ?? []) as Record<string, unknown>[];
    const termProp = props.find(p => p.key === 'GoTerm');
    const rawTerm = String(termProp?.value ?? '');
    const [aspectToken, ...nameParts] = rawTerm.split(':');
      terms.push({
      id,
      name: nameParts.join(':') || rawTerm || id,
      aspect: (aspectMap[aspectToken] ?? aspectToken) || 'NA',
    });
    seen.add(id);
  }

  return terms.sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}

function compareMembershipRows(a: SharedMembershipRow, b: SharedMembershipRow): number {
  return b.geneCount - a.geneCount
    || a.name.localeCompare(b.name)
    || a.id.localeCompare(b.id);
}

function compareGoMembershipRows(
  a: SharedMembershipRow & { aspect: string },
  b: SharedMembershipRow & { aspect: string },
): number {
  return b.geneCount - a.geneCount
    || a.aspect.localeCompare(b.aspect)
    || a.name.localeCompare(b.name)
    || a.id.localeCompare(b.id);
}

function buildSharedMembership<T extends { id: string; name: string }>(
  genes: CompareGeneProfile[],
  selector: (profile: CompareGeneProfile) => T[],
  minShared: number,
): SharedMembershipRow[] {
  const byId = new Map<string, { name: string; genes: Set<string> }>();
  for (const profile of genes) {
    for (const item of selector(profile)) {
      const bucket = byId.get(item.id) ?? { name: item.name, genes: new Set<string>() };
      bucket.genes.add(profile.symbol);
      byId.set(item.id, bucket);
    }
  }

  return [...byId.entries()]
    .map(([id, value]) => ({
      id,
      name: value.name,
      genes: [...value.genes].sort(),
      geneCount: value.genes.size,
    }))
    .filter(item => item.geneCount >= minShared)
    .sort(compareMembershipRows);
}

function buildSharedGoTerms(
  genes: CompareGeneProfile[],
  minShared: number,
): Array<SharedMembershipRow & { aspect: string }> {
  const byId = new Map<string, { name: string; aspect: string; genes: Set<string> }>();
  for (const profile of genes) {
    for (const term of profile.goTerms) {
      const bucket = byId.get(term.id) ?? { name: term.name, aspect: term.aspect, genes: new Set<string>() };
      bucket.genes.add(profile.symbol);
      byId.set(term.id, bucket);
    }
  }

  return [...byId.entries()]
    .map(([id, value]) => ({
      id,
      name: value.name,
      aspect: value.aspect,
      genes: [...value.genes].sort(),
      geneCount: value.genes.size,
    }))
    .filter(item => item.geneCount >= minShared)
    .sort(compareGoMembershipRows);
}

function buildGeneSpecificPathways(
  genes: CompareGeneProfile[],
  sharedPathwayIds: Set<string>,
  limit: number,
): Array<{ gene: string; pathways: CompareGenePathway[] }> {
  return genes.map(profile => ({
    gene: profile.symbol,
    pathways: profile.pathways
      .filter(pathway => !sharedPathwayIds.has(pathway.pathwayId))
      .slice(0, limit),
  }));
}

function buildGeneSpecificGoTerms(
  genes: CompareGeneProfile[],
  sharedGoIds: Set<string>,
  limit: number,
): GeneSpecificTermsRow[] {
  const rows: GeneSpecificTermsRow[] = [];
  for (const profile of genes) {
    const byAspect = new Map<string, Array<{ id: string; name: string }>>();
    for (const term of profile.goTerms) {
      if (sharedGoIds.has(term.id)) continue;
      const list = byAspect.get(term.aspect) ?? [];
      list.push({ id: term.id, name: term.name });
      byAspect.set(term.aspect, list);
    }
    for (const [aspect, terms] of byAspect.entries()) {
      rows.push({
        gene: profile.symbol,
        aspect,
        terms: terms
          .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id))
          .slice(0, limit),
      });
    }
  }
  return rows.sort((a, b) =>
    a.gene.localeCompare(b.gene)
    || a.aspect.localeCompare(b.aspect));
}

function buildPairwiseOverlap(
  genes: CompareGeneProfile[],
  interactions: InteractionEdge[],
): PairwiseOverlapRow[] {
  const interactionMap = new Map<string, number>();
  for (const edge of interactions) {
    const key = [edge.geneA, edge.geneB].sort().join('::');
    interactionMap.set(key, edge.score);
  }

  const rows: PairwiseOverlapRow[] = [];
  for (let i = 0; i < genes.length; i++) {
    for (let j = i + 1; j < genes.length; j++) {
      const a = genes[i]!;
      const b = genes[j]!;
      const sharedPathways = a.pathways
        .filter(pathway => b.pathways.some(other => other.pathwayId === pathway.pathwayId))
        .map(pathway => pathway.pathwayName);
      const sharedGoTerms = a.goTerms
        .filter(term => b.goTerms.some(other => other.id === term.id))
        .map(term => term.name);
      const key = [a.symbol, b.symbol].sort().join('::');
      rows.push({
        geneA: a.symbol,
        geneB: b.symbol,
        sharedPathwayCount: sharedPathways.length,
        sharedGoTermCount: sharedGoTerms.length,
        sharedPathways: sharedPathways.sort().slice(0, 10),
        sharedGoTerms: sharedGoTerms.sort().slice(0, 10),
        interactionScore: interactionMap.get(key),
      });
    }
  }

  return rows.sort((a, b) =>
    b.sharedPathwayCount - a.sharedPathwayCount
    || b.sharedGoTermCount - a.sharedGoTermCount
    || (b.interactionScore ?? 0) - (a.interactionScore ?? 0)
    || a.geneA.localeCompare(b.geneA)
    || a.geneB.localeCompare(b.geneB));
}

cli({
  site: 'aggregate',
  name: 'compare-genes',
  description: 'Compare a gene set across shared pathways, GO terms, and STRING interactions',
  database: 'aggregate',
  strategy: Strategy.PUBLIC,
  defaultFormat: 'json',
  timeoutSeconds: 180,
  args: [
    { name: 'genes', positional: true, required: true, help: 'Comma-separated gene symbols (for example TP53,BRCA1,EGFR)' },
    { name: 'organism', default: 'human', help: 'Organism (human, mouse, rat, etc.)' },
    { name: 'library', default: 'GO_Biological_Process_2023', help: 'Enrichr library for set-level GO enrichment' },
    { name: 'limit', type: 'int', default: 20, help: 'Maximum shared/enrichment rows to return (1-50)' },
    { name: 'minShared', type: 'int', default: 2, help: 'Minimum genes required to call a pathway or GO term shared' },
  ],
  columns: ['geneCount', 'sharedPathwayCount', 'sharedGoTermCount', 'interactionCount'],
  func: async (_ctx, args) => {
    const { genes, duplicateWarnings } = normalizeGenes(String(args.genes));
    if (genes.length < 2) {
      throw new CliError('ARGUMENT', 'At least 2 gene symbols are required',
        'Example: biocli aggregate compare-genes TP53,BRCA1,EGFR');
    }

    const org = resolveOrganism(String(args.organism));
    const limit = Math.max(1, Math.min(Number(args.limit ?? 20), 50));
    const minShared = Math.max(2, Math.min(Number(args.minShared ?? 2), genes.length));
    const library = String(args.library);

    const warnings: string[] = [...duplicateWarnings];
    const sources: string[] = [];

    const ncbiCtx = createHttpContextForDatabase('ncbi');
    const uniprotCtx = createHttpContextForDatabase('uniprot');
    const keggCtx = createHttpContextForDatabase('kegg');
    const stringCtx = createHttpContextForDatabase('string');

    const geneProfiles: CompareGeneProfile[] = [];
    const geneIds = new Map<string, string>();

    for (const gene of genes) {
      const profile: CompareGeneProfile = {
        symbol: gene,
        pathways: [],
        goTerms: [],
      };

      try {
        const sr = await ncbiCtx.fetchJson(buildEutilsUrl('esearch.fcgi', {
          db: 'gene',
          term: `${gene}[Gene Name] AND ${org.name}[Organism]`,
          retmax: '5',
          retmode: 'json',
        })) as Record<string, unknown>;
        const ids = ((sr.esearchresult as Record<string, unknown>)?.idlist as string[]) ?? [];
        if (ids.length > 0) {
          const summary = await ncbiCtx.fetchJson(buildEutilsUrl('esummary.fcgi', {
            db: 'gene',
            id: ids.join(','),
            retmode: 'json',
          }));
          const parsed = parseGeneSummaries(summary);
          const best = parsed.find(item => item.symbol.toUpperCase() === gene.toUpperCase()) ?? parsed[0];
          if (best) {
            profile.ncbiGeneId = best.geneId;
            profile.name = best.name;
            profile.chromosome = best.chromosome;
            geneIds.set(gene, best.geneId);
          }
        }
      } catch (error) {
        warnings.push(`NCBI ${gene}: ${error instanceof Error ? error.message : String(error)}`);
      }

      try {
        const upResult = await uniprotCtx.fetchJson(buildUniprotUrl('/uniprotkb/search', {
          query: `gene:${gene} AND organism_id:${org.taxId} AND reviewed:true`,
          format: 'json',
          size: '5',
        })) as Record<string, unknown>;
        const results = (upResult.results ?? []) as Record<string, unknown>[];
        if (results.length > 0) {
          const getGeneName = (entry: Record<string, unknown>) =>
            String(((entry.genes as { geneName?: { value?: string } }[] | undefined)?.[0]?.geneName?.value) ?? '');
          const entry = results.find(item => getGeneName(item).toUpperCase() === gene.toUpperCase()) ?? results[0]!;
          profile.uniprotAccession = String(entry.primaryAccession ?? '');

          const comments = (entry.comments ?? []) as Record<string, unknown>[];
          const funcComment = comments.find(comment => comment.commentType === 'FUNCTION');
          const funcTexts = (funcComment?.texts ?? []) as Record<string, unknown>[];
          profile.function = funcTexts.map(text => String(text.value ?? '')).join(' ') || undefined;
          profile.goTerms = parseUniProtGoTerms(entry, gene);
        }
      } catch (error) {
        warnings.push(`UniProt ${gene}: ${error instanceof Error ? error.message : String(error)}`);
      }

      geneProfiles.push(profile);
    }

    if (geneProfiles.some(profile => profile.ncbiGeneId)) sources.push('NCBI Gene');
    if (geneProfiles.some(profile => profile.uniprotAccession)) sources.push('UniProt');

    const genePathwayMap = new Map<string, CompareGenePathway[]>();
    for (const profile of geneProfiles) {
      const geneId = geneIds.get(profile.symbol);
      if (!geneId) continue;
      try {
        const linkText = await keggCtx.fetchText(buildKeggUrl(`/link/pathway/${org.keggOrg}:${geneId}`));
        const links = parseKeggTsv(linkText)
          .map(row => row.value.replace(/^path:/, ''))
          .filter(Boolean);
        genePathwayMap.set(profile.symbol, links.map(pathwayId => ({ pathwayId, pathwayName: pathwayId })));
      } catch (error) {
        warnings.push(`KEGG ${profile.symbol}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    const pathwayNameMap = new Map<string, string>();
    try {
      const listText = await keggCtx.fetchText(buildKeggUrl(`/list/pathway/${org.keggOrg}`));
      for (const row of parseKeggTsv(listText)) {
        pathwayNameMap.set(row.key.replace(/^path:/, ''), row.value.replace(/ - .*$/, ''));
      }
      if (genePathwayMap.size > 0) sources.push('KEGG');
    } catch (error) {
      if (genePathwayMap.size > 0) {
        warnings.push(`KEGG pathway names: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    for (const profile of geneProfiles) {
      const pathways = genePathwayMap.get(profile.symbol) ?? [];
      profile.pathways = pathways
        .map(pathway => ({
          pathwayId: pathway.pathwayId,
          pathwayName: pathwayNameMap.get(pathway.pathwayId) ?? pathway.pathwayId,
        }))
        .sort((a, b) => a.pathwayName.localeCompare(b.pathwayName) || a.pathwayId.localeCompare(b.pathwayId));
    }

    let interactionSubnetwork: InteractionEdge[] = [];
    try {
      const data = await stringCtx.fetchJson(buildStringUrl('network', {
        identifiers: genes.join('%0d'),
        species: String(org.taxId),
        required_score: '400',
      })) as Record<string, unknown>[];
      if (Array.isArray(data)) {
        const inputSet = new Set(genes.map(gene => gene.toUpperCase()));
        interactionSubnetwork = data
          .map(item => ({
            geneA: String(item.preferredName_A ?? ''),
            geneB: String(item.preferredName_B ?? ''),
            score: Number(item.score ?? 0),
            experimentalScore: Number(item.escore ?? 0),
            databaseScore: Number(item.dscore ?? 0),
            textminingScore: Number(item.tscore ?? 0),
          }))
          .filter(edge =>
            edge.geneA
            && edge.geneB
            && edge.geneA.toUpperCase() !== edge.geneB.toUpperCase()
            && inputSet.has(edge.geneA.toUpperCase())
            && inputSet.has(edge.geneB.toUpperCase()))
          .sort((a, b) =>
            b.score - a.score
            || a.geneA.localeCompare(b.geneA)
            || a.geneB.localeCompare(b.geneB));
        if (interactionSubnetwork.length > 0) sources.push('STRING');
      }
    } catch (error) {
      warnings.push(`STRING: ${error instanceof Error ? error.message : String(error)}`);
    }

    let goEnrichment: CompareGenesData['goEnrichment'] = [];
    try {
      const userListId = await submitGeneList(genes, 'biocli compare-genes');
      const results = await getEnrichment(userListId, library);
      goEnrichment = results.slice(0, limit).map(result => ({
        rank: Number(result.rank ?? 0),
        term: String(result.term ?? ''),
        adjustedPValue: Number(result.adjustedPValue ?? 1).toExponential(2),
        combinedScore: Number(result.combinedScore ?? 0),
        genes: String(result.genes ?? '')
          .split(',')
          .map(gene => gene.trim())
          .filter(Boolean),
        source: 'Enrichr',
      }));
      if (goEnrichment.length > 0) sources.push('Enrichr');
    } catch (error) {
      warnings.push(`Enrichr: ${error instanceof Error ? error.message : String(error)}`);
    }

    const sharedPathways = buildSharedMembership(geneProfiles, profile => profile.pathways.map(pathway => ({
      id: pathway.pathwayId,
      name: pathway.pathwayName,
    })), minShared).slice(0, limit);

    const sharedGoTerms = buildSharedGoTerms(geneProfiles, minShared).slice(0, limit);
    const sharedPathwayIds = new Set(sharedPathways.map(row => row.id));
    const sharedGoIds = new Set(sharedGoTerms.map(row => row.id));

    const geneSpecificPathways = buildGeneSpecificPathways(geneProfiles, sharedPathwayIds, limit);
    const geneSpecificGoTerms = buildGeneSpecificGoTerms(geneProfiles, sharedGoIds, limit);
    const pairwiseOverlap = buildPairwiseOverlap(geneProfiles, interactionSubnetwork);

    const data: CompareGenesData = {
      summary: {
        geneCount: geneProfiles.length,
        sharedPathwayCount: sharedPathways.length,
        sharedGoTermCount: sharedGoTerms.length,
        interactionCount: interactionSubnetwork.length,
        pairwiseComparisons: pairwiseOverlap.length,
        goEnrichmentTerms: goEnrichment.length,
      },
      genes: geneProfiles,
      sharedPathways,
      sharedGoTerms,
      geneSpecificPathways,
      geneSpecificGoTerms,
      pairwiseOverlap,
      interactionSubnetwork,
      goEnrichment,
    };

    return wrapResult(data, {
      ids: {},
      sources: uniqueStrings(sources),
      warnings,
      query: genes.join(','),
      organism: org.name,
    });
  },
});
