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
import { buildEutilsUrl } from '../../databases/ncbi.js';
import { buildUniprotUrl } from '../../databases/uniprot.js';
import { buildKeggUrl, parseKeggTsv } from '../../databases/kegg.js';
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
  args: [
    { name: 'dataset', positional: true, required: true, help: 'GEO accession (GSE*) or SRA accession (SRR*)' },
    { name: 'gene', help: 'Focus gene symbol(s), comma-separated (e.g. TP53,BRCA1)' },
    { name: 'outdir', required: true, help: 'Output directory for the prepared workspace' },
    { name: 'skip-download', type: 'boolean', default: false, help: 'Skip data download, only fetch annotations' },
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
          for (const file of files) {
            try {
              const resp = await fetch(`${supplUrl}${file.name}`);
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

    // ── Step 2: Gene annotations ────────────────────────────────────────
    if (genes.length > 0) {
      const geneAnnotations: Record<string, unknown>[] = [];

      for (const gene of genes) {
        try {
          // NCBI Gene search
          const searchResult = await ncbiCtx.fetchJson(buildEutilsUrl('esearch.fcgi', {
            db: 'gene', term: `${gene}[Gene Name] AND Homo sapiens[Organism]`, retmax: '1', retmode: 'json',
          })) as Record<string, unknown>;
          const geneIds = ((searchResult?.esearchresult as Record<string, unknown>)?.idlist as string[]) ?? [];

          if (geneIds.length > 0) {
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

            // UniProt protein info — use reviewed:true + exact symbol match (same as gene-profile)
            try {
              const uniprotCtx = createHttpContextForDatabase('uniprot');
              const upResult = await uniprotCtx.fetchJson(
                buildUniprotUrl('/uniprotkb/search', {
                  query: `gene:${gene} AND organism_id:9606 AND reviewed:true`,
                  format: 'json',
                  size: '5',
                }),
              ) as Record<string, unknown>;
              const upEntries = (upResult?.results ?? []) as Record<string, unknown>[];
              if (upEntries.length > 0) {
                // Find exact gene name match among candidates
                const getGeneName = (e: Record<string, unknown>): string => {
                  const gs = e.genes as Record<string, unknown>[] | undefined;
                  const gn = gs?.[0] as Record<string, unknown> | undefined;
                  const name = gn?.geneName as Record<string, unknown> | undefined;
                  return String(name?.value ?? '');
                };
                const exactMatch = upEntries.find(e => getGeneName(e).toUpperCase() === gene.toUpperCase());
                const best = exactMatch ?? upEntries[0];
                annotation.uniprotAccession = best.primaryAccession ?? '';
                sources.push('UniProt');
              }
            } catch { /* non-fatal */ }

            geneAnnotations.push(annotation);
            sources.push('NCBI Gene');
          }
        } catch (err) {
          warnings.push(`Gene ${gene}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }

      if (geneAnnotations.length > 0) {
        writeFileSync(join(annotDir, 'genes.json'), JSON.stringify(geneAnnotations, null, 2));
        steps.push({ step: 'gene-annotations', status: 'done', detail: `${geneAnnotations.length} gene(s) → annotations/genes.json` });
      }

      // KEGG pathways for genes — use NCBI Gene IDs (stable) instead of symbols
      try {
        const keggCtx = createHttpContextForDatabase('kegg');
        const allPathways: Record<string, unknown>[] = [];
        for (const annot of geneAnnotations) {
          const geneId = annot.ncbiGeneId as string | undefined;
          const symbol = annot.symbol as string;
          if (!geneId) continue;
          try {
            const linkText = await keggCtx.fetchText(buildKeggUrl(`/link/pathway/hsa:${geneId}`));
            if (linkText && linkText.trim()) {
              const links = parseKeggTsv(linkText);
              allPathways.push(...links.map(l => ({ gene: symbol, ncbiGeneId: geneId, pathway: l.value })));
            }
          } catch {
            warnings.push(`KEGG pathway for ${symbol} (hsa:${geneId}): no results`);
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
    const manifest = {
      biocliVersion: '0.2.0',
      createdAt: new Date().toISOString(),
      dataset,
      genes,
      organism: 'Homo sapiens',
      sources: [...new Set(sources)],
      warnings,
      directories: {
        data: 'data/',
        annotations: 'annotations/',
      },
      steps,
    };
    steps.push({ step: 'manifest', status: 'done', detail: `manifest.json → ${outdir}` });
    writeFileSync(join(outdir, 'manifest.json'), JSON.stringify(manifest, null, 2));

    return wrapResult({
      outdir,
      dataset,
      steps,
    }, {
      ids: { dataset, ...(genes.length === 1 ? { gene: genes[0] } : {}) },
      sources: [...new Set(sources)],
      warnings,
      query: dataset,
    });
  },
});
