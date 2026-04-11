/**
 * aggregate/workflow-profile — Functional profile for a gene set.
 *
 * Unlike workflow-annotate (per-gene annotations), this command focuses on
 * the SET-LEVEL view: shared pathways, interaction network, GO term
 * distribution, and enrichment. Think "what does this gene set DO together?"
 *
 * Output directory:
 *   profiles.json       — per-gene profile summaries (from gene-profile)
 *   interactions.csv    — STRING protein-protein interaction network
 *   go_summary.csv      — GO term frequency across the gene set
 *   shared_pathways.csv — KEGG pathways shared by 2+ input genes
 *   enrichment.csv      — Enrichr enrichment results
 *   report.md           — human-readable Markdown report
 *   manifest.json       — provenance
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
import { mkdirSync, existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { getVersion } from '../../version.js';

// ── CSV helper ───────────────────────────────────────────────────────────────

function toCsv(headers: string[], rows: Record<string, unknown>[]): string {
  const escape = (v: unknown): string => {
    const s = String(v ?? '');
    return s.includes(',') || s.includes('"') || s.includes('\n')
      ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [headers.join(','), ...rows.map(r => headers.map(h => escape(r[h])).join(','))].join('\n') + '\n';
}

// ── Main ─────────────────────────────────────────────────────────────────────

cli({
  site: 'aggregate',
  name: 'workflow-profile',
  description: 'Functional profile for a gene set (interactions, GO terms, shared pathways)',
  database: 'aggregate',
  strategy: Strategy.PUBLIC,
  defaultFormat: 'json',
  timeoutSeconds: 180,
  args: [
    { name: 'genes', positional: true, required: true, help: 'Gene symbols: comma-separated (TP53,BRCA1,EGFR,MYC,CDK2)' },
    { name: 'outdir', required: true, help: 'Output directory' },
    { name: 'organism', default: 'human', help: 'Organism (human, mouse, rat, etc.)' },
    { name: 'library', default: 'KEGG_2021_Human', help: 'Enrichr library' },
    { name: 'plan', type: 'boolean', default: false, help: 'Preview steps without executing' },
  ],
  examples: [
    {
      goal: 'Build a set-level profile workspace for TP53, BRCA1, and EGFR',
      command: 'biocli aggregate workflow-profile TP53,BRCA1,EGFR --outdir results/profile_panel -f json',
    },
    {
      goal: 'Preview a workflow-profile run without executing it',
      command: 'biocli aggregate workflow-profile TP53,BRCA1,EGFR --outdir results/profile_plan --plan true -f json',
    },
  ],
  columns: ['step', 'status', 'detail'],
  func: async (_ctx, args) => {
    const genes = String(args.genes).split(',').map(s => s.trim()).filter(Boolean);
    const outdir = String(args.outdir);
    const library = String(args.library);
    const planOnly = Boolean(args.plan);

    if (genes.length < 2) {
      throw new CliError('ARGUMENT', 'At least 2 gene symbols required for profiling',
        'Example: biocli aggregate workflow-profile TP53,BRCA1,EGFR,MYC,CDK2 --outdir ./profile');
    }

    const org = resolveOrganism(String(args.organism));
    const sources: string[] = [];
    const warnings: string[] = [];
    const steps: { step: string; status: string; detail: string }[] = [];

    if (planOnly) {
      return wrapResult({
        plan: [
          { step: 'gene-profiles', detail: `Query NCBI Gene + UniProt for ${genes.length} gene(s)` },
          { step: 'interactions', detail: `Query STRING network for all ${genes.length} genes` },
          { step: 'pathways', detail: `Find KEGG pathways shared by 2+ genes` },
          { step: 'go-summary', detail: `Aggregate GO terms across gene set` },
          { step: 'enrichment', detail: `Run Enrichr (${library})` },
          { step: 'output', detail: `Write profiles.json, interactions.csv, go_summary.csv, shared_pathways.csv, enrichment.csv, report.md → ${outdir}` },
        ],
        genes, organism: org.name, outdir,
      }, { ids: {}, sources: [], warnings: [], query: genes.join(','), organism: org.name });
    }

    if (!existsSync(outdir)) mkdirSync(outdir, { recursive: true });

    const ncbiCtx = createHttpContextForDatabase('ncbi');
    const uniprotCtx = createHttpContextForDatabase('uniprot');
    const keggCtx = createHttpContextForDatabase('kegg');
    const stringCtx = createHttpContextForDatabase('string');

    // ── Step 1: Per-gene profiles (NCBI + UniProt) ──────────────────────
    const profiles: Record<string, unknown>[] = [];
    const geneIds: Record<string, string> = {}; // symbol → ncbi gene id
    const allGoTerms: { gene: string; id: string; name: string; aspect: string }[] = [];

    for (const gene of genes) {
      const profile: Record<string, unknown> = { symbol: gene };

      try {
        const sr = await ncbiCtx.fetchJson(buildEutilsUrl('esearch.fcgi', {
          db: 'gene', term: `${gene}[Gene Name] AND ${org.name}[Organism]`,
          retmax: '5', retmode: 'json',
        })) as Record<string, unknown>;
        const ids = ((sr?.esearchresult as Record<string, unknown>)?.idlist as string[]) ?? [];
        if (ids.length > 0) {
          const summ = await ncbiCtx.fetchJson(buildEutilsUrl('esummary.fcgi', { db: 'gene', id: ids.join(','), retmode: 'json' }));
          const parsed = parseGeneSummaries(summ);
          const best = parsed.find(g => g.symbol.toUpperCase() === gene.toUpperCase()) ?? parsed[0];
          if (best) {
            profile.ncbiGeneId = best.geneId;
            profile.name = best.name;
            profile.chromosome = best.chromosome;
            geneIds[gene] = best.geneId;
          }
        }
      } catch (err) { warnings.push(`NCBI ${gene}: ${err instanceof Error ? err.message : String(err)}`); }

      try {
        const upResult = await uniprotCtx.fetchJson(buildUniprotUrl('/uniprotkb/search', {
          query: `gene:${gene} AND organism_id:${org.taxId} AND reviewed:true`, format: 'json', size: '5',
        })) as Record<string, unknown>;
        const results = (upResult?.results ?? []) as Record<string, unknown>[];
        if (results.length > 0) {
          const getGN = (e: Record<string, unknown>) => String(((e.genes as any)?.[0]?.geneName as any)?.value ?? '');
          const entry = results.find(e => getGN(e).toUpperCase() === gene.toUpperCase()) ?? results[0];
          profile.uniprotAccession = entry.primaryAccession;

          const comments = (entry.comments ?? []) as Record<string, unknown>[];
          const funcComment = comments.find(c => c.commentType === 'FUNCTION');
          const funcTexts = (funcComment?.texts ?? []) as Record<string, unknown>[];
          profile.function = funcTexts.map(t => String(t.value ?? '')).join(' ');

          const xrefs = (entry.uniProtKBCrossReferences ?? []) as Record<string, unknown>[];
          xrefs.filter(x => x.database === 'GO').forEach(x => {
            const id = String(x.id ?? '');
            const props = (x.properties ?? []) as Record<string, unknown>[];
            const termProp = props.find(p => p.key === 'GoTerm');
            const term = String(termProp?.value ?? '');
            const aspectMap: Record<string, string> = { C: 'CC', F: 'MF', P: 'BP' };
            const [aspect, ...nameParts] = term.split(':');
            allGoTerms.push({ gene, id, name: nameParts.join(':'), aspect: aspectMap[aspect] ?? aspect });
          });
        }
      } catch (err) { warnings.push(`UniProt ${gene}: ${err instanceof Error ? err.message : String(err)}`); }

      profiles.push(profile);
    }

    if (profiles.some(p => p.ncbiGeneId)) sources.push('NCBI Gene');
    if (profiles.some(p => p.uniprotAccession)) sources.push('UniProt');

    writeFileSync(join(outdir, 'profiles.json'), JSON.stringify(profiles, null, 2));
    steps.push({ step: 'gene-profiles', status: 'done', detail: `${profiles.length} gene(s) → profiles.json` });

    // ── Step 2: STRING interactions ──────────────────────────────────────
    const interactions: Record<string, unknown>[] = [];
    try {
      const data = await stringCtx.fetchJson(buildStringUrl('network', {
        identifiers: genes.join('%0d'),
        species: String(org.taxId),
        required_score: '400',
      })) as Record<string, unknown>[];

      if (Array.isArray(data)) {
        for (const item of data) {
          interactions.push({
            geneA: String(item.preferredName_A ?? ''),
            geneB: String(item.preferredName_B ?? ''),
            score: Number(item.score ?? 0),
            experimentalScore: Number(item.escore ?? 0),
            databaseScore: Number(item.dscore ?? 0),
            textminingScore: Number(item.tscore ?? 0),
          });
        }
        sources.push('STRING');
      }
    } catch (err) { warnings.push(`STRING: ${err instanceof Error ? err.message : String(err)}`); }

    writeFileSync(join(outdir, 'interactions.csv'), toCsv(
      ['geneA', 'geneB', 'score', 'experimentalScore', 'databaseScore', 'textminingScore'],
      interactions,
    ));
    steps.push({ step: 'interactions', status: 'done', detail: `${interactions.length} interactions → interactions.csv` });

    // ── Step 3: Shared KEGG pathways ────────────────────────────────────
    const genePathways: Record<string, Set<string>> = {};
    const pathwayGenes: Record<string, Set<string>> = {};

    for (const gene of genes) {
      const gid = geneIds[gene];
      if (!gid) continue;
      try {
        const linkText = await keggCtx.fetchText(buildKeggUrl(`/link/pathway/${org.keggOrg}:${gid}`));
        if (linkText?.trim()) {
          const links = parseKeggTsv(linkText);
          genePathways[gene] = new Set(links.map(l => l.value.replace(/^path:/, '')));
          for (const pid of genePathways[gene]) {
            if (!pathwayGenes[pid]) pathwayGenes[pid] = new Set();
            pathwayGenes[pid].add(gene);
          }
        }
      } catch { /* non-fatal */ }
    }

    // Resolve pathway names
    let pathNameMap = new Map<string, string>();
    try {
      const listText = await keggCtx.fetchText(buildKeggUrl(`/list/pathway/${org.keggOrg}`));
      pathNameMap = new Map(parseKeggTsv(listText).map(p => [p.key, p.value.replace(/ - .*$/, '')]));
      if (Object.keys(pathwayGenes).length > 0) sources.push('KEGG');
    } catch { /* non-fatal */ }

    // Only pathways shared by 2+ genes
    const sharedPathways = Object.entries(pathwayGenes)
      .filter(([, gSet]) => gSet.size >= 2)
      .map(([pid, gSet]) => ({
        pathwayId: pid,
        pathwayName: pathNameMap.get(pid) ?? pid,
        geneCount: gSet.size,
        genes: [...gSet].join(', '),
      }))
      .sort((a, b) => b.geneCount - a.geneCount);

    writeFileSync(join(outdir, 'shared_pathways.csv'), toCsv(
      ['pathwayId', 'pathwayName', 'geneCount', 'genes'],
      sharedPathways,
    ));
    steps.push({ step: 'shared-pathways', status: 'done', detail: `${sharedPathways.length} pathways shared by 2+ genes → shared_pathways.csv` });

    // ── Step 4: GO term frequency ───────────────────────────────────────
    const goFreq: Record<string, { id: string; name: string; aspect: string; genes: Set<string> }> = {};
    for (const gt of allGoTerms) {
      if (!goFreq[gt.id]) goFreq[gt.id] = { id: gt.id, name: gt.name, aspect: gt.aspect, genes: new Set() };
      goFreq[gt.id].genes.add(gt.gene);
    }
    const goSummary = Object.values(goFreq)
      .map(g => ({ id: g.id, name: g.name, aspect: g.aspect, geneCount: g.genes.size, genes: [...g.genes].join(', ') }))
      .sort((a, b) => b.geneCount - a.geneCount);

    writeFileSync(join(outdir, 'go_summary.csv'), toCsv(
      ['id', 'name', 'aspect', 'geneCount', 'genes'],
      goSummary,
    ));
    steps.push({ step: 'go-summary', status: 'done', detail: `${goSummary.length} GO terms → go_summary.csv` });

    // ── Step 5: Enrichment ──────────────────────────────────────────────
    const enrichmentRows: Record<string, unknown>[] = [];
    try {
      const userListId = await submitGeneList(genes);
      const results = await getEnrichment(userListId, library);
      for (let i = 0; i < Math.min(results.length, 30); i++) {
        const r = results[i];
        enrichmentRows.push({
          rank: i + 1, term: r.term, library,
          adjustedPValue: Number(r.adjustedPValue).toExponential(2),
          combinedScore: Number(r.combinedScore).toFixed(1),
          genes: r.genes,
        });
      }
      sources.push('Enrichr');
    } catch (err) { warnings.push(`Enrichr: ${err instanceof Error ? err.message : String(err)}`); }

    writeFileSync(join(outdir, 'enrichment.csv'), toCsv(
      ['rank', 'term', 'library', 'adjustedPValue', 'combinedScore', 'genes'],
      enrichmentRows,
    ));
    steps.push({ step: 'enrichment', status: enrichmentRows.length > 0 ? 'done' : 'skipped',
      detail: `${enrichmentRows.length} terms → enrichment.csv` });

    // ── Step 6: report.md ───────────────────────────────────────────────
    const lines: string[] = [
      `# Gene Set Functional Profile`, '',
      `**Generated by biocli** v${getVersion()} on ${new Date().toISOString()}`, '',
      `## Input`, '',
      `- **Genes**: ${genes.join(', ')} (${genes.length})`,
      `- **Organism**: ${org.name}`,
      `- **Sources**: ${sources.join(', ')}`,
      warnings.length > 0 ? `- **Warnings**: ${warnings.length}` : '', '',
    ];

    if (sharedPathways.length > 0) {
      lines.push(`## Shared Pathways (${sharedPathways.length})`, '',
        '| Pathway | Genes | Count |', '|---------|-------|-------|');
      for (const p of sharedPathways.slice(0, 20)) {
        lines.push(`| ${p.pathwayName} | ${p.genes} | ${p.geneCount} |`);
      }
      lines.push('');
    }

    if (interactions.length > 0) {
      lines.push(`## Protein Interactions (${interactions.length})`, '',
        '| Gene A | Gene B | Score |', '|--------|--------|-------|');
      for (const i of interactions.slice(0, 20)) {
        lines.push(`| ${i.geneA} | ${i.geneB} | ${i.score} |`);
      }
      lines.push('');
    }

    if (goSummary.length > 0) {
      const topGo = goSummary.filter(g => g.geneCount >= 2).slice(0, 15);
      if (topGo.length > 0) {
        lines.push(`## GO Terms Shared by 2+ Genes (${topGo.length})`, '',
          '| GO Term | Aspect | Genes | Count |', '|---------|--------|-------|-------|');
        for (const g of topGo) {
          lines.push(`| ${g.name} | ${g.aspect} | ${g.genes} | ${g.geneCount} |`);
        }
        lines.push('');
      }
    }

    if (enrichmentRows.length > 0) {
      lines.push(`## Enrichment (${library})`, '',
        '| Rank | Term | Adj. P-value | Genes |', '|------|------|-------------|-------|');
      for (const r of enrichmentRows.slice(0, 15)) {
        lines.push(`| ${r.rank} | ${r.term} | ${r.adjustedPValue} | ${r.genes} |`);
      }
      lines.push('');
    }

    if (warnings.length > 0) {
      lines.push('## Warnings', '');
      for (const w of warnings) lines.push(`- ${w}`);
      lines.push('');
    }

    lines.push('---', `*Generated by [biocli](https://github.com/youngfly93/biocli)*`);

    writeFileSync(join(outdir, 'report.md'), lines.filter(l => l !== undefined).join('\n') + '\n');
    steps.push({ step: 'report', status: 'done', detail: `report.md → ${outdir}` });

    // ── manifest.json ───────────────────────────────────────────────────
    const manifest = {
      biocliVersion: getVersion(), createdAt: new Date().toISOString(),
      command: 'workflow-profile', input: { genes, organism: org.name, library },
      output: {
        'profiles.json': `${profiles.length} gene profiles`,
        'interactions.csv': `${interactions.length} interactions`,
        'shared_pathways.csv': `${sharedPathways.length} shared pathways`,
        'go_summary.csv': `${goSummary.length} GO terms`,
        'enrichment.csv': `${enrichmentRows.length} enrichment terms`,
        'report.md': 'Markdown report',
      },
      sources, warnings,
    };
    steps.push({ step: 'manifest', status: 'done', detail: `manifest.json → ${outdir}` });
    writeFileSync(join(outdir, 'manifest.json'), JSON.stringify(manifest, null, 2));

    return wrapResult({ outdir, genes, steps, summary: {
      geneCount: genes.length, interactionCount: interactions.length,
      sharedPathwayCount: sharedPathways.length, goTermCount: goSummary.length,
      enrichmentTerms: enrichmentRows.length, sources, warnings,
    }}, { ids: {}, sources, warnings, query: genes.join(','), organism: org.name });
  },
});
