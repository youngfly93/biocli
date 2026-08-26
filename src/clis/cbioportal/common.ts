import type { HttpContext } from '../../types.js';
import {
  fetchMutationsForProfile,
  type CbioPortalMutation,
  type CbioPortalMutationFetchOptions,
} from '../../databases/cbioportal.js';
import {
  CANCER_GENE_CONTEXT_BY_SYMBOL,
  CANCER_GENE_CONTEXT_ENTRIES,
  CANCER_GENE_CONTEXT_REFERENCE,
} from '../../reference-data/cancer-gene-context-v1.js';

export function clampLimit(value: unknown, fallback = 500, max = 500): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(1, Math.min(Math.trunc(parsed), max));
}

export function summarizeCounts(
  items: string[],
  label: string,
  limit = 5,
): Array<Record<string, number | string>> {
  const counts = new Map<string, number>();
  for (const item of items) {
    const normalized = item.trim();
    if (!normalized) continue;
    counts.set(normalized, (counts.get(normalized) ?? 0) + 1);
  }

  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([value, count]) => ({ [label]: value, count }));
}

export async function fetchAllMutationPages(
  ctx: HttpContext,
  opts: CbioPortalMutationFetchOptions,
  maxPages = 200,
): Promise<CbioPortalMutation[]> {
  const pageSize = Math.max(1, Math.min(opts.pageSize ?? 500, 500));
  const mutations: CbioPortalMutation[] = [];

  for (let pageNumber = 0; pageNumber < maxPages; pageNumber++) {
    const page = await fetchMutationsForProfile(ctx, { ...opts, pageSize, pageNumber });
    if (page.length === 0) break;
    mutations.push(...page);
    if (page.length < pageSize) break;
  }

  return mutations;
}

/**
 * Fetch mutations for anchor samples filtered by batches of candidate genes.
 *
 * Instead of fetching ALL mutations for N samples (expensive — 30-60k rows for
 * high-TMB cohorts), this queries in batches of candidate genes, dramatically
 * reducing data transfer.
 *
 * Performance: ~200 genes / 50 per batch = 4 API calls vs 60-120 for full scan.
 */
export async function fetchCoMutationsByGeneBatches(
  ctx: HttpContext,
  opts: {
    molecularProfileId: string;
    sampleIds: string[];
    candidateGeneIds: number[];
    pageSize?: number;
  },
): Promise<CbioPortalMutation[]> {
  const BATCH_SIZE = 50;
  const mutations: CbioPortalMutation[] = [];

  for (let i = 0; i < opts.candidateGeneIds.length; i += BATCH_SIZE) {
    const batch = opts.candidateGeneIds.slice(i, i + BATCH_SIZE);
    const batchMutations = await fetchAllMutationPages(ctx, {
      molecularProfileId: opts.molecularProfileId,
      sampleIds: opts.sampleIds,
      entrezGeneIds: batch,
      pageSize: opts.pageSize ?? 500,
      projection: 'DETAILED',
    });
    mutations.push(...batchMutations);
  }

  return mutations;
}

/**
 * Large genes whose high mutation rate reflects coding length and TMB
 * rather than functional driver selection. Co-mutations with these genes
 * should be annotated so agents and users do not over-interpret them.
 */
export const TMB_INDICATOR_GENES: ReadonlySet<string> = new Set([
  'TTN', 'MUC16', 'CSMD3', 'RYR2', 'LRP1B', 'ZFHX4', 'USH2A',
  'XIRP2', 'FLG', 'SPTA1', 'DNAH5', 'OBSCN', 'MUC17', 'HMCN1',
  'FAT3', 'FAT4', 'PCLO', 'PKHD1', 'RYR3', 'SYNE1', 'SYNE2',
  'DNAH11', 'DNAH17', 'PCDH15', 'CDH23', 'GPR98', 'HYDIN',
  'APOB', 'FSIP2', 'DST', 'NEB', 'AHNAK2', 'COL6A3',
]);

/**
 * Annotate a co-mutation partner gene with biological context.
 *
 * Returns a short tag:
 *   - "tmb_indicator" — large gene, co-occurrence likely reflects TMB
 *   - "known_driver"  — compatibility label for a versioned cancer-context candidate
 *   - "other"         — neither of the above
 */
export function annotatePartnerContext(
  geneSymbol: string,
  entrezGeneId: number,
): { tag: 'tmb_indicator' | 'known_driver' | 'other'; note: string } {
  const upper = geneSymbol.toUpperCase();
  if (TMB_INDICATOR_GENES.has(upper)) {
    return {
      tag: 'tmb_indicator',
      note: `${geneSymbol} is a large gene; co-occurrence likely reflects elevated tumor mutation burden rather than functional synergy`,
    };
  }
  const referenceEntry = CANCER_GENE_CONTEXT_BY_SYMBOL.get(upper);
  if (referenceEntry?.entrezGeneId === entrezGeneId) {
    return {
      tag: 'known_driver',
      note: `${geneSymbol} is in ${CANCER_GENE_CONTEXT_REFERENCE.id}; membership is a retrieval heuristic, not independent evidence of driver status`,
    };
  }
  return { tag: 'other', note: '' };
}

/**
 * Compatibility export for the bounded cBioPortal candidate query.
 *
 * The scientific and identity metadata lives in the versioned symbol/Entrez
 * reference. Consumers must use the paired reference for biological labels.
 */
export const CANCER_DRIVER_GENE_IDS: number[] = CANCER_GENE_CONTEXT_ENTRIES.map(
  entry => entry.entrezGeneId,
);
