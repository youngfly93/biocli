/**
 * aggregate/workflow-annotate — Annotate a gene list into a research-ready directory.
 *
 * Input: gene list (comma-separated, --input file, or stdin)
 * Output directory:
 *   summary.json    — high-level overview (gene count, sources, warnings)
 *   genes.csv       — per-gene annotations (symbol, name, function, chromosome, etc.)
 *   pathways.csv    — all KEGG pathways linked to any input gene
 *   enrichment.csv  — Enrichr pathway enrichment results
 *   report.md       — human-readable Markdown report
 *   manifest.json   — full provenance (biocli version, run timestamp, sources, inputs)
 *
 * Cross-queries: NCBI Gene + UniProt + KEGG + Enrichr
 */

import { cli, Strategy } from '../../registry.js';
import { CliError } from '../../errors.js';
import { wrapResult } from '../../types.js';
import { createHttpContextForDatabase } from '../../databases/index.js';
import { buildEutilsUrl } from '../../databases/ncbi.js';
import { buildUniprotUrl } from '../../databases/uniprot.js';
import { buildKeggUrl, parseKeggTsv } from '../../databases/kegg.js';
import { submitGeneList, getEnrichment } from '../../databases/enrichr.js';
import { parseGeneSummaries } from '../_shared/xml-helpers.js';
import { resolveOrganism } from '../_shared/organism-db.js';
import { mkdirSync, existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { getVersion } from '../../version.js';
import { toCsv } from '../../csv.js';

// ── Types ────────────────────────────────────────────────────────────────────

interface GeneAnnotation {
  symbol: string;
  ncbiGeneId: string;
  name: string;
  summary: string;
  chromosome: string;
  location: string;
  uniprotAccession: string;
  proteinFunction: string;
  subcellularLocation: string;
  goTerms: string;
}

interface PathwayLink {
  gene: string;
  pathwayId: string;
  pathwayName: string;
}

interface EnrichmentRow {
  rank: number;
  term: string;
  library: string;
  adjustedPValue: string;
  combinedScore: string;
  genes: string;
}

// ── Main ─────────────────────────────────────────────────────────────────────

cli({
  site: 'aggregate',
  name: 'workflow-annotate',
  description: 'Annotate a gene list into a research-ready directory',
  database: 'aggregate',
  strategy: Strategy.PUBLIC,
  defaultFormat: 'json',
  timeoutSeconds: 120,
  readOnly: false,
  sideEffects: ['writes-filesystem'],
  artifacts: [
    { path: '<outdir>/', kind: 'directory', description: 'Annotation workspace directory' },
    { path: '<outdir>/genes.csv', kind: 'file', description: 'Per-gene annotations table' },
    { path: '<outdir>/pathways.csv', kind: 'file', description: 'Pathway links table' },
    { path: '<outdir>/enrichment.csv', kind: 'file', description: 'Enrichment results table' },
    { path: '<outdir>/report.md', kind: 'file', description: 'Human-readable workflow report' },
    { path: '<outdir>/summary.json', kind: 'file', description: 'Summary metrics for the run' },
    { path: '<outdir>/manifest.json', kind: 'file', description: 'Workflow provenance manifest' },
  ],
  args: [
    { name: 'genes', positional: true, required: true, help: 'Gene symbols: comma-separated (TP53,BRCA1) or use --input file' },
    { name: 'outdir', required: true, help: 'Output directory for annotation results' },
    { name: 'organism', default: 'human', help: 'Organism (human, mouse, rat, etc.)' },
    { name: 'library', default: 'KEGG_2021_Human', help: 'Enrichr library for enrichment analysis' },
    { name: 'plan', type: 'boolean', default: false, help: 'Preview steps without executing' },
  ],
  examples: [
    {
      goal: 'Annotate a small cancer gene set into a report directory',
      command: 'biocli aggregate workflow-annotate TP53,EGFR,KRAS --outdir results/annotate_tp53_egfr_kras -f json',
    },
    {
      goal: 'Preview the workflow-annotate plan before running it',
      command: 'biocli aggregate workflow-annotate TP53,BRCA1 --outdir results/annotate_plan --plan true -f json',
    },
  ],
  whenToUse: 'Use when you already have a gene list and want a local annotation bundle with per-gene, pathway, and enrichment outputs.',
  columns: ['step', 'status', 'detail'],
  func: async (_ctx, args) => {
    const geneInput = String(args.genes);
    const genes = geneInput.split(',').map(s => s.trim()).filter(Boolean);
    const outdir = String(args.outdir);
    const orgInput = String(args.organism);
    const library = String(args.library);
    const planOnly = Boolean(args.plan);

    if (genes.length === 0) {
      throw new CliError('ARGUMENT', 'At least one gene symbol is required',
        'Example: biocli aggregate workflow-annotate TP53,BRCA1,EGFR --outdir ./results');
    }

    const org = resolveOrganism(orgInput);
    const sources: string[] = [];
    const warnings: string[] = [];
    const steps: { step: string; status: string; detail: string }[] = [];

    // ── Plan mode ───────────────────────────────────────────────────────
    if (planOnly) {
      return wrapResult({
        plan: [
          { step: 'gene-annotations', detail: `Query NCBI Gene + UniProt for ${genes.length} gene(s)` },
          { step: 'pathways', detail: `Query KEGG pathways for each gene` },
          { step: 'enrichment', detail: `Run Enrichr enrichment (${library}) for gene set` },
          { step: 'output', detail: `Write genes.csv, pathways.csv, enrichment.csv, report.md, summary.json, manifest.json → ${outdir}` },
        ],
        genes,
        organism: org.name,
        outdir,
      }, { ids: {}, sources: [], warnings: [], query: genes.join(','), organism: org.name });
    }

    // Create output directory
    if (!existsSync(outdir)) mkdirSync(outdir, { recursive: true });

    const ncbiCtx = createHttpContextForDatabase('ncbi');
    const uniprotCtx = createHttpContextForDatabase('uniprot');
    const keggCtx = createHttpContextForDatabase('kegg');

    // ── Step 1: Gene annotations (NCBI + UniProt) ───────────────────────
    const geneAnnotations: GeneAnnotation[] = [];

    for (const gene of genes) {
      const annot: GeneAnnotation = {
        symbol: gene, ncbiGeneId: '', name: '', summary: '',
        chromosome: '', location: '', uniprotAccession: '',
        proteinFunction: '', subcellularLocation: '', goTerms: '',
      };

      // NCBI Gene
      try {
        const searchResult = await ncbiCtx.fetchJson(buildEutilsUrl('esearch.fcgi', {
          db: 'gene', term: `${gene}[Gene Name] AND ${org.name}[Organism]`,
          retmax: '5', retmode: 'json',
        })) as Record<string, unknown>;
        const ids = ((searchResult?.esearchresult as Record<string, unknown>)?.idlist as string[]) ?? [];

        if (ids.length > 0) {
          const summaryResult = await ncbiCtx.fetchJson(buildEutilsUrl('esummary.fcgi', {
            db: 'gene', id: ids.join(','), retmode: 'json',
          }));
          const parsed = parseGeneSummaries(summaryResult);
          const best = parsed.find(g => g.symbol.toUpperCase() === gene.toUpperCase()) ?? parsed[0];
          if (best) {
            annot.ncbiGeneId = best.geneId;
            annot.name = best.name;
            annot.summary = best.summary;
            annot.chromosome = best.chromosome;
            annot.location = best.location;
          }
        }
      } catch (err) {
        warnings.push(`NCBI Gene ${gene}: ${err instanceof Error ? err.message : String(err)}`);
      }

      // UniProt
      try {
        const upResult = await uniprotCtx.fetchJson(buildUniprotUrl('/uniprotkb/search', {
          query: `gene:${gene} AND organism_id:${org.taxId} AND reviewed:true`,
          format: 'json', size: '5',
        })) as Record<string, unknown>;
        const results = (upResult?.results ?? []) as Record<string, unknown>[];
        if (results.length > 0) {
          const getGeneName = (e: Record<string, unknown>) => {
            const gs = e.genes as Record<string, unknown>[] | undefined;
            const gn = gs?.[0] as Record<string, unknown> | undefined;
            return String((gn?.geneName as Record<string, unknown>)?.value ?? '');
          };
          const exact = results.find(e => getGeneName(e).toUpperCase() === gene.toUpperCase());
          const entry = exact ?? results[0];
          annot.uniprotAccession = String(entry.primaryAccession ?? '');

          const comments = (entry.comments ?? []) as Record<string, unknown>[];
          const funcComment = comments.find(c => c.commentType === 'FUNCTION');
          const funcTexts = (funcComment?.texts ?? []) as Record<string, unknown>[];
          annot.proteinFunction = funcTexts.map(t => String(t.value ?? '')).join(' ');

          const locComment = comments.find(c => c.commentType === 'SUBCELLULAR LOCATION');
          const locEntries = (locComment?.subcellularLocations ?? []) as Record<string, unknown>[];
          annot.subcellularLocation = locEntries.map(l => String((l.location as Record<string, unknown>)?.value ?? '')).filter(Boolean).join(', ');

          const xrefs = (entry.uniProtKBCrossReferences ?? []) as Record<string, unknown>[];
          const goTerms = xrefs.filter(x => x.database === 'GO').map(x => {
            const props = (x.properties ?? []) as Record<string, unknown>[];
            const termProp = props.find(p => p.key === 'GoTerm');
            return String(termProp?.value ?? '');
          });
          annot.goTerms = goTerms.slice(0, 10).join('; ');
        }
      } catch (err) {
        warnings.push(`UniProt ${gene}: ${err instanceof Error ? err.message : String(err)}`);
      }

      geneAnnotations.push(annot);
    }

    if (geneAnnotations.some(a => a.ncbiGeneId)) sources.push('NCBI Gene');
    if (geneAnnotations.some(a => a.uniprotAccession)) sources.push('UniProt');

    writeFileSync(join(outdir, 'genes.csv'), toCsv(
      ['symbol', 'ncbiGeneId', 'name', 'chromosome', 'location', 'uniprotAccession', 'proteinFunction', 'subcellularLocation', 'goTerms', 'summary'],
      geneAnnotations as unknown as Record<string, unknown>[],
    ));
    steps.push({ step: 'gene-annotations', status: 'done', detail: `${geneAnnotations.length} gene(s) → genes.csv` });

    // ── Step 2: KEGG pathways ───────────────────────────────────────────
    const pathwayLinks: PathwayLink[] = [];
    const pathIdSet = new Set<string>();

    for (const annot of geneAnnotations) {
      if (!annot.ncbiGeneId) continue;
      try {
        const linkText = await keggCtx.fetchText(buildKeggUrl(`/link/pathway/${org.keggOrg}:${annot.ncbiGeneId}`));
        if (linkText && linkText.trim()) {
          const links = parseKeggTsv(linkText);
          for (const l of links) {
            const pid = l.value.replace(/^path:/, '');
            pathIdSet.add(pid);
            pathwayLinks.push({ gene: annot.symbol, pathwayId: pid, pathwayName: '' });
          }
        }
      } catch { /* non-fatal */ }
    }

    // Resolve pathway names
    if (pathIdSet.size > 0) {
      try {
        const listText = await keggCtx.fetchText(buildKeggUrl(`/list/pathway/${org.keggOrg}`));
        const allPaths = parseKeggTsv(listText);
        const nameMap = new Map(allPaths.map(p => [p.key.replace(/^path:/, ''), p.value.replace(/ - .*$/, '')]));
        for (const link of pathwayLinks) {
          link.pathwayName = nameMap.get(link.pathwayId) ?? link.pathwayId;
        }
        sources.push('KEGG');
      } catch (err) {
        warnings.push(`KEGG pathway names: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    writeFileSync(join(outdir, 'pathways.csv'), toCsv(
      ['gene', 'pathwayId', 'pathwayName'],
      pathwayLinks as unknown as Record<string, unknown>[],
    ));
    steps.push({ step: 'pathways', status: 'done', detail: `${pathwayLinks.length} pathway links (${pathIdSet.size} unique) → pathways.csv` });

    // ── Step 3: Enrichment (Enrichr) ────────────────────────────────────
    const enrichmentRows: EnrichmentRow[] = [];

    if (genes.length >= 2) {
      try {
        const userListId = await submitGeneList(genes);
        const results = await getEnrichment(userListId, library);
        for (let i = 0; i < Math.min(results.length, 30); i++) {
          const r = results[i];
          enrichmentRows.push({
            rank: i + 1,
            term: String(r.term),
            library,
            adjustedPValue: Number(r.adjustedPValue).toExponential(2),
            combinedScore: Number(r.combinedScore).toFixed(1),
            genes: String(r.genes),
          });
        }
        sources.push('Enrichr');
      } catch (err) {
        warnings.push(`Enrichr: ${err instanceof Error ? err.message : String(err)}`);
      }
    } else {
      warnings.push('Enrichment skipped: at least 2 genes required');
    }

    writeFileSync(join(outdir, 'enrichment.csv'), toCsv(
      ['rank', 'term', 'library', 'adjustedPValue', 'combinedScore', 'genes'],
      enrichmentRows as unknown as Record<string, unknown>[],
    ));
    steps.push({ step: 'enrichment', status: enrichmentRows.length > 0 ? 'done' : 'skipped',
      detail: enrichmentRows.length > 0 ? `${enrichmentRows.length} terms → enrichment.csv` : 'skipped (need ≥ 2 genes)' });

    // ── Step 4: report.md ───────────────────────────────────────────────
    const reportLines: string[] = [
      `# Gene Annotation Report`,
      ``,
      `**Generated by biocli** v${getVersion()} on ${new Date().toISOString()}`,
      ``,
      `## Input`,
      ``,
      `- **Genes**: ${genes.join(', ')}`,
      `- **Organism**: ${org.name}`,
      `- **Sources**: ${sources.join(', ') || 'none'}`,
      warnings.length > 0 ? `- **Warnings**: ${warnings.length}` : '',
      ``,
      `## Gene Summary`,
      ``,
      `| Symbol | Name | Chromosome | UniProt | Function |`,
      `|--------|------|------------|---------|----------|`,
    ];

    for (const g of geneAnnotations) {
      const func = g.proteinFunction.length > 80 ? g.proteinFunction.slice(0, 80) + '...' : g.proteinFunction;
      reportLines.push(`| ${g.symbol} | ${g.name} | ${g.chromosome} | ${g.uniprotAccession} | ${func} |`);
    }

    if (pathwayLinks.length > 0) {
      // Deduplicate pathways
      const uniquePathways = [...new Map(pathwayLinks.map(p => [p.pathwayId, p])).values()];
      reportLines.push('', `## KEGG Pathways (${uniquePathways.length} unique)`, '',
        '| Pathway | Genes |', '|---------|-------|');
      const pathwayGenes = new Map<string, string[]>();
      for (const link of pathwayLinks) {
        const list = pathwayGenes.get(link.pathwayName) ?? [];
        list.push(link.gene);
        pathwayGenes.set(link.pathwayName, list);
      }
      for (const [name, gList] of [...pathwayGenes.entries()].slice(0, 20)) {
        reportLines.push(`| ${name} | ${[...new Set(gList)].join(', ')} |`);
      }
    }

    if (enrichmentRows.length > 0) {
      reportLines.push('', `## Enrichment Analysis (${library})`, '',
        '| Rank | Term | Adj. P-value | Genes |', '|------|------|-------------|-------|');
      for (const r of enrichmentRows.slice(0, 15)) {
        reportLines.push(`| ${r.rank} | ${r.term} | ${r.adjustedPValue} | ${r.genes} |`);
      }
    }

    if (warnings.length > 0) {
      reportLines.push('', '## Warnings', '');
      for (const w of warnings) reportLines.push(`- ${w}`);
    }

    reportLines.push('', '---', `*Report generated by [biocli](https://github.com/youngfly93/biocli)*`);

    writeFileSync(join(outdir, 'report.md'), reportLines.filter(l => l !== undefined).join('\n') + '\n');
    steps.push({ step: 'report', status: 'done', detail: `report.md → ${outdir}` });

    // ── Step 5: summary.json + manifest.json ────────────────────────────
    const summary = {
      geneCount: genes.length,
      annotatedCount: geneAnnotations.filter(a => a.ncbiGeneId).length,
      pathwayCount: pathIdSet.size,
      enrichmentTerms: enrichmentRows.length,
      sources,
      warnings,
    };
    writeFileSync(join(outdir, 'summary.json'), JSON.stringify(summary, null, 2));

    const manifest = {
      biocliVersion: getVersion(),
      createdAt: new Date().toISOString(),
      command: 'workflow-annotate',
      input: { genes, organism: org.name, library },
      output: {
        'genes.csv': `${geneAnnotations.length} genes`,
        'pathways.csv': `${pathwayLinks.length} pathway links`,
        'enrichment.csv': `${enrichmentRows.length} terms`,
        'report.md': 'Markdown report',
        'summary.json': 'Overview statistics',
      },
      sources,
      warnings,
    };

    steps.push({ step: 'manifest', status: 'done', detail: `summary.json + manifest.json → ${outdir}` });
    writeFileSync(join(outdir, 'manifest.json'), JSON.stringify(manifest, null, 2));

    return wrapResult({
      outdir,
      genes,
      steps,
      summary,
    }, {
      ids: {},
      sources,
      warnings,
      query: genes.join(','),
      organism: org.name,
    });
  },
});
