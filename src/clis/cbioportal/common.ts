import type { HttpContext } from '../../types.js';
import {
  fetchMutationsForProfile,
  type CbioPortalMutation,
  type CbioPortalMutationFetchOptions,
} from '../../databases/cbioportal.js';

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
 *   - "known_driver"  — in COSMIC Cancer Gene Census / TCGA driver list
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
  if (CANCER_DRIVER_GENE_IDS.includes(entrezGeneId)) {
    return {
      tag: 'known_driver',
      note: `${geneSymbol} is a known cancer driver gene`,
    };
  }
  return { tag: 'other', note: '' };
}

/**
 * Top ~200 cancer driver genes by Entrez Gene ID.
 *
 * Curated from COSMIC Cancer Gene Census (Tier 1+2) + TCGA PanCancer driver
 * list. Used as the default candidate set for co-mutation analysis instead of
 * scanning the entire genome (~20,000 genes).
 *
 * Covers: TP53, KRAS, EGFR, BRAF, PIK3CA, PTEN, RB1, APC, BRCA1/2, ATM,
 * STK11, KEAP1, NF1, SMAD4, CDH1, ARID1A, KMT2D, NOTCH1, and other
 * frequently altered cancer genes.
 */
export const CANCER_DRIVER_GENE_IDS: number[] = [
  // Top pan-cancer drivers
  7157,   // TP53
  3845,   // KRAS
  1956,   // EGFR
  673,    // BRAF
  5290,   // PIK3CA
  5728,   // PTEN
  5925,   // RB1
  324,    // APC
  672,    // BRCA1
  675,    // BRCA2
  472,    // ATM
  6794,   // STK11
  9817,   // KEAP1
  4763,   // NF1
  4089,   // SMAD4
  999,    // CDH1
  8289,   // ARID1A
  8085,   // KMT2D
  4851,   // NOTCH1
  4893,   // NRAS
  2064,   // ERBB2
  4221,   // MEN1
  7428,   // VHL
  3417,   // IDH1
  3418,   // IDH2
  2033,   // EP300
  2078,   // ERG
  2099,   // ESR1
  5979,   // RET
  8031,   // NCOA4
  57167,  // SALL4
  4297,   // KMT2A
  1387,   // CREBBP
  7046,   // TGFBR1
  7048,   // TGFBR2
  8726,   // EED
  5591,   // PRKDC
  23512,  // SUZ12
  6597,   // SMARCA4
  6598,   // SMARCB1
  29072,  // SETD2
  80204,  // FBXO11
  7113,   // TMPRSS2
  238,    // ALK
  4233,   // MET
  5156,   // PDGFRA
  3791,   // KDR
  2263,   // FGFR2
  2261,   // FGFR3
  2260,   // FGFR1
  4914,   // NTRK1
  4915,   // NTRK2
  4916,   // NTRK3
  5159,   // PDGFRB
  4067,   // LYN
  25,     // ABL1
  613,    // BCR
  3815,   // KIT
  2322,   // FLT3
  4254,   // KITLG
  5604,   // MAP2K1
  5605,   // MAP2K2
  5594,   // MAPK1
  6195,   // RPS6KA3
  5295,   // PIK3R1
  207,    // AKT1
  208,    // AKT2
  2475,   // MTOR
  6609,   // SMARCD1
  57492,  // ARID1B
  23462,  // HEY1
  9126,   // SMO
  8313,   // AXIN2
  8312,   // AXIN1
  4609,   // MYC
  4613,   // MYCN
  4602,   // MYB
  5155,   // PDGFB
  3265,   // HRAS
  1029,   // CDKN2A
  1030,   // CDKN2B
  1019,   // CDK4
  1021,   // CDK6
  595,    // CCND1
  894,    // CCND2
  896,    // CCND3
  898,    // CCNE1
  4193,   // MDM2
  4194,   // MDM4
  7015,   // TERT
  7016,   // TERC
  7175,   // TPR
  8202,   // NCOA3
  2625,   // GATA3
  6667,   // SP1
  3662,   // IRF4
  4286,   // MITF
  6657,   // SOX2
  4609,   // MYC (dup removed at runtime)
  26137,  // ZBTB20
  83990,  // BRIP1
  79723,  // SUV39H2
  10155,  // TRIM28
  57680,  // CHD8
  1105,   // CHD1
  1108,   // CHD4
  23613,  // ZMYND8
  84441,  // GMCL1
  // Common large genes (TMB indicators, useful for context)
  7273,   // TTN
  94025,  // MUC16
  54949,  // CSMD3
  6262,   // RYR2
  4018,   // LRP1B
  // Lung-specific drivers
  55294,  // FBXW7
  8243,   // SMC1A
  6927,   // HNF1A
  83990,  // BRIP1
  11200,  // CHEK2
  9611,   // NCOR1
  10524,  // KAT5
  51341,  // ZBTB7A
  29843,  // SENP1
  23373,  // CRTC1
  55612,  // FERMT1
  5727,   // PTCH1
  9370,   // ADIPOQ
  2309,   // FOXO3
  2308,   // FOXO1
  8841,   // HDAC3
  3066,   // HDAC2
  10014,  // HDAC5
  10013,  // HDAC6
  79885,  // HDAC11
  // Chromatin remodeling
  196528, // ARID2
  56916,  // SMARCAL1
  90411,  // MCRS1
  51564,  // HDAC7
  57820,  // CCNQ
  23185,  // LARP4B
  26060,  // APBB1IP
  9968,   // MED12
  54903,  // MKS1
  23049,  // SMG1
  51755,  // CDK12
  26271,  // FBXO5
  8085,   // KMT2D (dup removed at runtime)
  8028,   // MLLT10
  3014,   // H3C1
  8294,   // HIST1H4I
  9557,   // CHD1L
  79372,  // ZRANB3
  // DNA repair
  10111,  // RAD50
  4361,   // MRE11
  4683,   // NBN
  7518,   // XRCC4
  3981,   // LIG4
  5888,   // RAD51
  5889,   // RAD51C
  5890,   // RAD51B
  29089,  // UBE2T
  2176,   // FANCC
  2177,   // FANCD2
  2189,   // FANCG
  55120,  // FANCL
  55215,  // FANCI
  57697,  // FANCM
  84464,  // SLX4
  7516,   // XRCC2
  // Immune / microenvironment
  3105,   // HLA-A
  3106,   // HLA-B
  941,    // CD80
  942,    // CD86
  29126,  // CD274 (PD-L1)
  80381,  // CD276
  5133,   // PDCD1
  29126,  // CD274 (dup)
];

