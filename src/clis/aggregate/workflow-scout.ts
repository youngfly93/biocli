/**
 * aggregate/workflow-scout — Scout datasets for a research question.
 *
 * Searches GEO and SRA for relevant datasets based on gene + disease/topic,
 * ranks candidates, and provides structured recommendations for the user
 * to select before downloading with `workflow prepare`.
 *
 * Cross-queries:
 *   - GEO (datasets with expression data)
 *   - SRA (sequencing runs)
 *   - NCBI Gene (gene context for query refinement)
 */

import { cli, Strategy } from '../../registry.js';
import { CliError } from '../../errors.js';
import { wrapResult } from '../../types.js';
import { createHttpContextForDatabase } from '../../databases/index.js';
import { buildEutilsUrl } from '../../databases/ncbi.js';

interface ScoutCandidate {
  rank: number;
  accession: string;
  title: string;
  organism: string;
  type: string;
  samples: number;
  date: string;
  relevance: string;
  source: string;
}

cli({
  site: 'aggregate',
  name: 'workflow-scout',
  description: 'Scout GEO/SRA datasets for a research question',
  database: 'aggregate',
  strategy: Strategy.PUBLIC,
  defaultFormat: 'json',
  timeoutSeconds: 60,
  args: [
    { name: 'query', positional: true, required: true, help: 'Research topic (e.g. "TP53 breast cancer RNA-seq")' },
    { name: 'gene', help: 'Focus gene symbol (refines search)' },
    { name: 'organism', default: 'Homo sapiens', help: 'Organism filter' },
    { name: 'limit', type: 'int', default: 10, help: 'Max candidates per source' },
    { name: 'type', default: 'gse', choices: ['gse', 'gds', 'all'], help: 'GEO entry type filter' },
  ],
  examples: [
    {
      goal: 'Scout public datasets for an EGFR lung adenocarcinoma project',
      command: 'biocli aggregate workflow-scout "EGFR lung adenocarcinoma RNA-seq" --gene EGFR --organism "Homo sapiens" -f json',
    },
    {
      goal: 'Find GEO dataset candidates for breast cancer RNA-seq',
      command: 'biocli aggregate workflow-scout "breast cancer RNA-seq" --type gse -f json',
    },
  ],
  whenToUse: 'Use when you are still selecting a GEO or SRA dataset for a research question and need ranked candidates before downloading.',
  columns: ['rank', 'accession', 'title', 'type', 'samples', 'date', 'source'],
  func: async (_ctx, args) => {
    const query = String(args.query).trim();
    const gene = args.gene ? String(args.gene).trim() : undefined;
    const organism = String(args.organism);
    const limit = Math.max(1, Math.min(Number(args.limit), 50));
    const typeFilter = String(args.type).toUpperCase();

    if (!query) throw new CliError('ARGUMENT', 'Search query is required');

    const sources: string[] = [];
    const warnings: string[] = [];

    const ncbiCtx = createHttpContextForDatabase('ncbi');

    // Build refined search terms
    const geneClause = gene ? `${gene}[Gene Name] AND ` : '';
    const orgClause = organism ? `${organism}[Organism] AND ` : '';

    // ── GEO search ──────────────────────────────────────────────────────
    const geoCandidates: ScoutCandidate[] = [];
    try {
      const geoTerm = typeFilter === 'ALL'
        ? `${geneClause}${orgClause}${query}`
        : `${geneClause}${orgClause}${query} AND ${typeFilter}[Entry Type]`;

      const searchResult = await ncbiCtx.fetchJson(buildEutilsUrl('esearch.fcgi', {
        db: 'gds',
        term: geoTerm,
        retmax: String(limit),
        retmode: 'json',
        sort: 'relevance',
      })) as Record<string, unknown>;

      const esearch = searchResult?.esearchresult as Record<string, unknown> | undefined;
      const ids: string[] = (esearch?.idlist as string[] | undefined) ?? [];

      if (ids.length > 0) {
        const summaryResult = await ncbiCtx.fetchJson(buildEutilsUrl('esummary.fcgi', {
          db: 'gds',
          id: ids.join(','),
          retmode: 'json',
        })) as Record<string, unknown>;

        const resultObj = summaryResult?.result as Record<string, unknown> | undefined;
        const uids: string[] = (resultObj?.uids as string[] | undefined) ?? [];

        for (let i = 0; i < uids.length; i++) {
          const item = (resultObj?.[uids[i]] ?? {}) as Record<string, unknown>;
          geoCandidates.push({
            rank: i + 1,
            accession: String(item.accession ?? `GDS${uids[i]}`),
            title: String(item.title ?? ''),
            organism: String(item.taxon ?? ''),
            type: String(item.entrytype ?? ''),
            samples: Number(item.n_samples ?? 0),
            date: String(item.pdat ?? ''),
            relevance: gene
              ? (String(item.title ?? '').toLowerCase().includes(gene.toLowerCase()) ? 'gene in title' : 'keyword match')
              : 'keyword match',
            source: 'GEO',
          });
        }
        sources.push('GEO');
      }
    } catch (err) {
      warnings.push(`GEO search failed: ${err instanceof Error ? err.message : String(err)}`);
    }

    // ── SRA search ──────────────────────────────────────────────────────
    const sraCandidates: ScoutCandidate[] = [];
    try {
      const sraTerm = `${geneClause}${orgClause}${query}`;

      const searchResult = await ncbiCtx.fetchJson(buildEutilsUrl('esearch.fcgi', {
        db: 'sra',
        term: sraTerm,
        retmax: String(limit),
        retmode: 'json',
        sort: 'relevance',
      })) as Record<string, unknown>;

      const esearch = searchResult?.esearchresult as Record<string, unknown> | undefined;
      const ids: string[] = (esearch?.idlist as string[] | undefined) ?? [];

      if (ids.length > 0) {
        const summaryResult = await ncbiCtx.fetchJson(buildEutilsUrl('esummary.fcgi', {
          db: 'sra',
          id: ids.join(','),
          retmode: 'json',
        })) as Record<string, unknown>;

        const resultObj = summaryResult?.result as Record<string, unknown> | undefined;
        const uids: string[] = (resultObj?.uids as string[] | undefined) ?? [];

        for (let i = 0; i < uids.length; i++) {
          const item = (resultObj?.[uids[i]] ?? {}) as Record<string, unknown>;
          const expXml = String(item.expxml ?? '');
          const runsXml = String(item.runs ?? '');

          // Extract from embedded XML
          const titleMatch = expXml.match(/<Title>([^<]*)<\/Title>/);
          const orgMatch = expXml.match(/taxname="([^"]*)"/);
          const accMatch = runsXml.match(/acc="([^"]*)"/);
          const strategyMatch = expXml.match(/<Library_strategy>([^<]*)<\/Library_strategy>/);

          sraCandidates.push({
            rank: i + 1,
            accession: accMatch?.[1] ?? `SRA${uids[i]}`,
            title: (titleMatch?.[1] ?? '').slice(0, 100),
            organism: orgMatch?.[1] ?? '',
            type: strategyMatch?.[1] ?? 'SRA',
            samples: Number(item.total_runs ?? 1),
            date: String(item.createdate ?? ''),
            relevance: 'keyword match',
            source: 'SRA',
          });
        }
        sources.push('SRA');
      }
    } catch (err) {
      warnings.push(`SRA search failed: ${err instanceof Error ? err.message : String(err)}`);
    }

    // ── Merge and rank ──────────────────────────────────────────────────
    const allCandidates = [...geoCandidates, ...sraCandidates];
    if (!allCandidates.length) {
      throw new CliError('NOT_FOUND',
        `No datasets found for "${query}"`,
        'Try broader search terms, or remove --gene/--organism filters');
    }

    // Re-rank: prefer more samples, gene-in-title, recent date
    allCandidates.sort((a, b) => {
      // Gene in title gets priority
      const aGeneBoost = a.relevance === 'gene in title' ? 1000 : 0;
      const bGeneBoost = b.relevance === 'gene in title' ? 1000 : 0;
      // More samples = better
      const score = (bGeneBoost + b.samples) - (aGeneBoost + a.samples);
      if (score !== 0) return score;
      // Tie-break by date (newer first)
      return b.date.localeCompare(a.date);
    });

    // Re-assign ranks
    allCandidates.forEach((c, i) => { c.rank = i + 1; });

    const nextSteps = allCandidates.slice(0, 3).map(c =>
      c.source === 'GEO'
        ? `biocli geo download ${c.accession} --list-only`
        : `biocli sra download ${c.accession} --dry-run`
    );

    return wrapResult({
      candidates: allCandidates,
      summary: `Found ${geoCandidates.length} GEO + ${sraCandidates.length} SRA candidates for "${query}"`,
      nextSteps,
    }, {
      ids: gene ? { gene } : {},
      sources,
      warnings,
      query,
      organism,
    });
  },
});
