/**
 * aggregate/workflow-prepare — Prepare a research-ready working directory.
 *
 * Takes a user-selected dataset (from workflow-scout) and:
 *   1. Downloads GEO supplementary files or SRA metadata
 *   2. Fetches gene annotations (NCBI Gene + UniProt)
 *   3. Fetches pathway context (KEGG)
 *   4. Generates a structured manifest.json
 *
 * Output: a self-contained directory with data + annotations + manifest.
 */

import { cli, Strategy } from '../../registry.js';
import { CliError } from '../../errors.js';
import { wrapResult } from '../../types.js';
import { createHttpContextForDatabase } from '../../databases/index.js';
import { allSettledWithProgress, reportProgress } from '../../progress.js';
import { buildEutilsUrl } from '../../databases/ncbi.js';
import { buildUniprotUrl } from '../../databases/uniprot.js';
import { buildKeggUrl, parseKeggTsv } from '../../databases/kegg.js';
import { getVersion } from '../../version.js';
import { mkdirSync, existsSync, writeFileSync, createWriteStream } from 'node:fs';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';

cli({
  site: 'aggregate',
  name: 'workflow-prepare',
  description: 'Prepare a research-ready directory from a selected dataset',
  database: 'aggregate',
  strategy: Strategy.PUBLIC,
  defaultFormat: 'json',
  timeoutSeconds: 300,
  readOnly: false,
  sideEffects: ['writes-filesystem', 'downloads-remote-files'],
  artifacts: [
    { path: '<outdir>/data/', kind: 'directory', description: 'Downloaded dataset files or dataset staging area' },
    { path: '<outdir>/annotations/', kind: 'directory', description: 'Gene and pathway annotation files' },
    { path: '<outdir>/manifest.json', kind: 'file', description: 'Workflow provenance manifest' },
  ],
  args: [
    { name: 'dataset', positional: true, required: true, help: 'GEO accession (GSE*) or SRA accession (SRR*)', producedBy: ['aggregate/workflow-scout', 'geo/search', 'sra/search'] },
    { name: 'gene', help: 'Focus gene symbol(s), comma-separated (e.g. TP53,BRCA1)' },
    { name: 'outdir', required: true, help: 'Output directory for the prepared workspace' },
    { name: 'skip-download', type: 'boolean', default: false, help: 'Skip data download, only fetch annotations' },
  ],
  examples: [
    {
      goal: 'Prepare a GEO workspace with TP53-focused annotations',
      command: 'biocli aggregate workflow-prepare GSE315149 --gene TP53 --outdir results/GSE315149 -f json',
    },
    {
      goal: 'Prepare an SRA workspace without downloading raw data',
      command: 'biocli aggregate workflow-prepare SRR12345678 --gene EGFR --outdir results/SRR12345678 --skip-download true -f json',
    },
  ],
  columns: ['step', 'status', 'detail'],
  func: async (_ctx, args) => {
    const dataset = String(args.dataset).trim().toUpperCase();
    const geneInput = args.gene ? String(args.gene) : undefined;
    const genes = geneInput ? geneInput.split(',').map(s => s.trim()).filter(Boolean) : [];
    const outdir = String(args.outdir);
    const skipDownload = Boolean(args['skip-download']);

    if (!dataset) throw new CliError('ARGUMENT', 'Dataset accession is required');

    const isGEO = /^GSE\d+$/.test(dataset);
    const isSRA = /^[SDE]RR\d+$/i.test(dataset);
    if (!isGEO && !isSRA) {
      throw new CliError('ARGUMENT',
        `Unsupported dataset type: "${dataset}"`,
        'Use a GSE accession (GEO) or SRR/ERR/DRR accession (SRA)');
    }

    // Create output directory structure
    reportProgress('Preparing output directories…');
    const dataDir = join(outdir, 'data');
    const annotDir = join(outdir, 'annotations');
    for (const dir of [outdir, dataDir, annotDir]) {
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    }

    const sources: string[] = [];
    const warnings: string[] = [];
    const steps: { step: string; status: string; detail: string }[] = [];

    const ncbiCtx = createHttpContextForDatabase('ncbi');

    // ── Step 1: Download dataset ────────────────────────────────────────
    if (!skipDownload) {
      if (isGEO) {
        try {
          const prefix = dataset.slice(0, -3) + 'nnn';
          const supplUrl = `https://ftp.ncbi.nlm.nih.gov/geo/series/${prefix}/${dataset}/suppl/`;
          reportProgress('Listing GEO supplementary files…');
          const html = await ncbiCtx.fetchText(supplUrl);

          // Parse file list
          const linkRegex = /<a\s+href="([^"]+)">[^<]+<\/a>\s+[\d-]+\s+[\d:]+\s+([\d.]+[KMG]?)/gi;
          const files: { name: string; size: string }[] = [];
          let match;
          while ((match = linkRegex.exec(html)) !== null) {
            if (match[1] !== '../' && !match[1].endsWith('/')) {
              files.push({ name: match[1], size: match[2] });
            }
          }

          let downloaded = 0;
          for (const [index, file] of files.entries()) {
            try {
              reportProgress(`Downloading GEO file ${index + 1}/${files.length}: ${file.name} (${file.size})…`);
              const resp = await ncbiCtx.fetch(`${supplUrl}${file.name}`);
              if (resp.ok && resp.body) {
                const ws = createWriteStream(join(dataDir, file.name));
                await pipeline(Readable.fromWeb(resp.body as any), ws);
                downloaded++;
              }
            } catch (err) {
              warnings.push(`Download ${file.name}: ${err instanceof Error ? err.message : String(err)}`);
            }
          }
          steps.push({ step: 'download', status: 'done', detail: `${downloaded}/${files.length} GEO files → ${dataDir}` });
          sources.push('GEO');
        } catch (err) {
          steps.push({ step: 'download', status: 'failed', detail: String(err instanceof Error ? err.message : err) });
          warnings.push(`GEO download: ${err instanceof Error ? err.message : String(err)}`);
        }
      } else {
        // SRA: just save metadata, actual FASTQ download is too large for prepare
        steps.push({ step: 'download', status: 'skipped', detail: 'SRA FASTQ download too large for prepare — use `biocli sra download` separately' });
      }
    } else {
      steps.push({ step: 'download', status: 'skipped', detail: '--skip-download flag' });
    }

    // ── Step 2: Gene annotations (parallel per-gene) ─────────────────────
    if (genes.length > 0) {
      const uniprotCtx = createHttpContextForDatabase('uniprot');

      async function annotateGene(gene: string): Promise<Record<string, unknown> | null> {
        const searchResult = await ncbiCtx.fetchJson(buildEutilsUrl('esearch.fcgi', {
          db: 'gene', term: `${gene}[Gene Name] AND Homo sapiens[Organism]`, retmax: '1', retmode: 'json',
        })) as Record<string, unknown>;
        const geneIds = ((searchResult?.esearchresult as Record<string, unknown>)?.idlist as string[]) ?? [];
        if (!geneIds.length) return null;

        const summaryResult = await ncbiCtx.fetchJson(buildEutilsUrl('esummary.fcgi', {
          db: 'gene', id: geneIds[0], retmode: 'json',
        })) as Record<string, unknown>;
        const resultObj = summaryResult?.result as Record<string, unknown> | undefined;
        const entry = resultObj?.[geneIds[0]] as Record<string, unknown> | undefined;

        const annotation: Record<string, unknown> = {
          symbol: gene,
          ncbiGeneId: geneIds[0],
          name: entry?.description ?? '',
          chromosome: entry?.chromosome ?? '',
          summary: entry?.summary ?? '',
        };

        // UniProt protein info (non-fatal)
        try {
          const upResult = await uniprotCtx.fetchJson(
            buildUniprotUrl('/uniprotkb/search', {
              query: `gene:${gene} AND organism_id:9606 AND reviewed:true`,
              format: 'json', size: '5',
            }),
          ) as Record<string, unknown>;
          const upEntries = (upResult?.results ?? []) as Record<string, unknown>[];
          if (upEntries.length > 0) {
            const getGeneName = (e: Record<string, unknown>): string => {
              const gs = e.genes as Record<string, unknown>[] | undefined;
              const gn = gs?.[0] as Record<string, unknown> | undefined;
              const name = gn?.geneName as Record<string, unknown> | undefined;
              return String(name?.value ?? '');
            };
            const exactMatch = upEntries.find(e => getGeneName(e).toUpperCase() === gene.toUpperCase());
            const best = exactMatch ?? upEntries[0];
            annotation.uniprotAccession = best.primaryAccession ?? '';
          }
        } catch { /* non-fatal */ }

        return annotation;
      }

      const annotResults = await allSettledWithProgress(
        'Waiting on gene annotations for',
        genes.map(gene => ({
          label: gene,
          task: () => annotateGene(gene),
        })),
      );
      const geneAnnotations: Record<string, unknown>[] = [];
      const annotSources = new Set<string>();
      for (let i = 0; i < annotResults.length; i++) {
        const r = annotResults[i];
        if (r.status === 'fulfilled' && r.value) {
          geneAnnotations.push(r.value);
          annotSources.add('NCBI Gene');
          if (r.value.uniprotAccession) annotSources.add('UniProt');
        } else if (r.status === 'rejected') {
          warnings.push(`Gene ${genes[i]}: ${r.reason instanceof Error ? r.reason.message : String(r.reason)}`);
        }
      }
      for (const s of annotSources) sources.push(s);

      if (geneAnnotations.length > 0) {
        writeFileSync(join(annotDir, 'genes.json'), JSON.stringify(geneAnnotations, null, 2));
        steps.push({ step: 'gene-annotations', status: 'done', detail: `${geneAnnotations.length} gene(s) → annotations/genes.json` });
      }

      // KEGG pathways for genes (parallel) — use NCBI Gene IDs (stable)
      try {
        const keggCtx = createHttpContextForDatabase('kegg');
        const pathwayResults = await allSettledWithProgress(
          'Waiting on KEGG pathways for',
          geneAnnotations.map(annot => ({
            label: String(annot.symbol ?? ''),
            task: async () => {
              const geneId = annot.ncbiGeneId as string | undefined;
              const symbol = annot.symbol as string;
              if (!geneId) return [];
              const linkText = await keggCtx.fetchText(buildKeggUrl(`/link/pathway/hsa:${geneId}`));
              if (!linkText?.trim()) return [];
              const links = parseKeggTsv(linkText);
              return links.map(l => ({ gene: symbol, ncbiGeneId: geneId, pathway: l.value }));
            },
          })),
        );
        const allPathways: Record<string, unknown>[] = [];
        for (let i = 0; i < pathwayResults.length; i++) {
          const r = pathwayResults[i];
          if (r.status === 'fulfilled') {
            allPathways.push(...r.value);
          } else {
            const symbol = (geneAnnotations[i]?.symbol as string) ?? genes[i];
            warnings.push(`KEGG pathway for ${symbol}: ${r.reason instanceof Error ? r.reason.message : String(r.reason)}`);
          }
        }
        if (allPathways.length > 0) {
          writeFileSync(join(annotDir, 'pathways.json'), JSON.stringify(allPathways, null, 2));
          steps.push({ step: 'pathways', status: 'done', detail: `${allPathways.length} pathway links → annotations/pathways.json` });
          sources.push('KEGG');
        }
      } catch (err) {
        warnings.push(`KEGG pathways: ${err instanceof Error ? err.message : String(err)}`);
      }
    } else {
      steps.push({ step: 'gene-annotations', status: 'skipped', detail: 'No --gene specified' });
    }

    // ── Step 3: Generate manifest ───────────────────────────────────────
    reportProgress('Writing manifest…');
    steps.push({ step: 'manifest', status: 'done', detail: `manifest.json → ${outdir}` });
    const result = wrapResult({
      outdir,
      dataset,
      steps,
    }, {
      ids: { dataset, ...(genes.length === 1 ? { gene: genes[0] } : {}) },
      sources: [...new Set(sources)],
      warnings,
      query: dataset,
      provenance: [{
        source: isGEO ? 'GEO' : 'SRA',
        recordIds: [dataset],
      }],
    });

    const manifest = {
      biocliVersion: getVersion(),
      createdAt: result.queriedAt,
      dataset,
      genes,
      organism: 'Homo sapiens',
      sources: result.sources,
      warnings: result.warnings,
      completeness: result.completeness,
      provenance: result.provenance,
      directories: {
        data: 'data/',
        annotations: 'annotations/',
      },
      steps,
    };
    writeFileSync(join(outdir, 'manifest.json'), JSON.stringify(manifest, null, 2));

    return result;
  },
});
