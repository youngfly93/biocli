/**
 * GDSC reference dataset loader and derived sensitivity index.
 *
 * GDSC is distributed as bulk release files. biocli downloads the official
 * compound annotation + fitted dose-response files once, then builds a local
 * summary index that hero workflows can query without reparsing the upstream
 * workbooks every time.
 */

import { homedir } from 'node:os';
import { join } from 'node:path';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
import xlsx from 'xlsx';
import { ApiError, ConfigError } from '../errors.js';
import type { HttpContext } from '../types.js';
import { GDSC_BASE_URL } from '../databases/gdsc.js';

export const GDSC_RELEASE = '8.5';
export const DEFAULT_GDSC_STALE_AFTER_DAYS = 90;
export const GDSC_INDEX_VERSION = 1;
const MAX_DATASET_TOP_HITS = 5;
const MAX_TISSUE_TOP_HITS = 3;

const GDSC_FILES = [
  {
    key: 'compoundsCsv',
    filename: 'screened_compounds_rel_8.5.csv',
    url: `${GDSC_BASE_URL}/screened_compounds_rel_8.5.csv`,
    minBytes: 1_000,
  },
  {
    key: 'gdsc1Xlsx',
    filename: 'GDSC1_fitted_dose_response_27Oct23.xlsx',
    url: `${GDSC_BASE_URL}/GDSC1_fitted_dose_response_27Oct23.xlsx`,
    minBytes: 1_000_000,
  },
  {
    key: 'gdsc2Xlsx',
    filename: 'GDSC2_fitted_dose_response_27Oct23.xlsx',
    url: `${GDSC_BASE_URL}/GDSC2_fitted_dose_response_27Oct23.xlsx`,
    minBytes: 1_000_000,
  },
] as const;

type GdscFileKey = typeof GDSC_FILES[number]['key'];

export interface GdscPaths {
  dir: string;
  compoundsCsv: string;
  gdsc1Xlsx: string;
  gdsc2Xlsx: string;
  meta: string;
  index: string;
}

export interface GdscDatasetFileMeta {
  key: GdscFileKey;
  filename: string;
  url: string;
  sizeBytes: number;
  sha256: string;
}

export interface GdscDownloadMeta {
  source: string;
  release: string;
  fetchedAt: string;
  staleAfterDays: number;
  indexVersion: number;
  files: GdscDatasetFileMeta[];
}

export interface GdscCompound {
  drugId: string;
  drugName: string;
  synonyms: string[];
  target?: string;
  targetPathway?: string;
}

export interface GdscSensitivityHit {
  dataset: 'GDSC1' | 'GDSC2';
  cellLineName: string;
  sangerModelId?: string;
  tissue: string;
  zScore?: number;
  auc?: number;
  lnIc50?: number;
}

export interface GdscTissueSummary {
  tissue: string;
  rowCount: number;
  strongSensitiveCount: number;
  bestZScore?: number;
  topHits: GdscSensitivityHit[];
}

export interface GdscDatasetSummary {
  dataset: 'GDSC1' | 'GDSC2';
  rowCount: number;
  strongSensitiveCount: number;
  bestZScore?: number;
  topHits: GdscSensitivityHit[];
  tissues: GdscTissueSummary[];
}

export interface GdscDrugEntry {
  compound: GdscCompound;
  totalRowCount: number;
  strongSensitiveCount: number;
  datasets: GdscDatasetSummary[];
}

export interface GdscSensitivityIndex {
  meta: GdscDownloadMeta;
  aliases: Record<string, string[]>;
  drugs: Record<string, GdscDrugEntry>;
}

interface MutableTissueSummary {
  tissue: string;
  rowCount: number;
  strongSensitiveCount: number;
  bestZScore?: number;
  topHits: GdscSensitivityHit[];
}

interface MutableDatasetSummary {
  dataset: 'GDSC1' | 'GDSC2';
  rowCount: number;
  strongSensitiveCount: number;
  bestZScore?: number;
  topHits: GdscSensitivityHit[];
  tissues: Map<string, MutableTissueSummary>;
}

interface MutableDrugEntry {
  compound: GdscCompound;
  totalRowCount: number;
  strongSensitiveCount: number;
  datasets: Map<'GDSC1' | 'GDSC2', MutableDatasetSummary>;
}

function compareHits(a: GdscSensitivityHit, b: GdscSensitivityHit): number {
  const aZ = Number.isFinite(a.zScore) ? Number(a.zScore) : Number.POSITIVE_INFINITY;
  const bZ = Number.isFinite(b.zScore) ? Number(b.zScore) : Number.POSITIVE_INFINITY;
  if (aZ !== bZ) return aZ - bZ;

  const aAuc = Number.isFinite(a.auc) ? Number(a.auc) : Number.POSITIVE_INFINITY;
  const bAuc = Number.isFinite(b.auc) ? Number(b.auc) : Number.POSITIVE_INFINITY;
  if (aAuc !== bAuc) return aAuc - bAuc;

  return a.cellLineName.localeCompare(b.cellLineName);
}

function pushTopHit(list: GdscSensitivityHit[], hit: GdscSensitivityHit, limit: number): void {
  if (!Number.isFinite(hit.zScore) && !Number.isFinite(hit.auc)) return;
  const key = `${hit.dataset}::${hit.cellLineName}::${hit.sangerModelId ?? ''}::${hit.tissue}`;
  const existingIndex = list.findIndex(item =>
    `${item.dataset}::${item.cellLineName}::${item.sangerModelId ?? ''}::${item.tissue}` === key);
  if (existingIndex >= 0) {
    if (compareHits(hit, list[existingIndex]!) < 0) list[existingIndex] = hit;
  } else {
    list.push(hit);
  }
  list.sort(compareHits);
  if (list.length > limit) list.length = limit;
}

function normalizeAlias(value: string): string {
  return String(value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

function normalizeWhitespace(value: string): string {
  return String(value ?? '')
    .replace(/[_/]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function parseNumber(value: unknown): number | undefined {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  const normalized = String(value ?? '').trim();
  if (!normalized) return undefined;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function readMeta(path: string): GdscDownloadMeta | null {
  if (!existsSync(path)) return null;
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf-8')) as GdscDownloadMeta;
    if (!parsed.fetchedAt || !Array.isArray(parsed.files)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function getGdscDownloadMeta(): GdscDownloadMeta | null {
  return readMeta(gdscPaths().meta);
}

function writeJsonAtomic(path: string, data: unknown): void {
  const tmp = `${path}.tmp-${process.pid}`;
  writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n', 'utf-8');
  renameSync(tmp, path);
}

function sha256OfFile(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function ensureDir(dir: string): void {
  try {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  } catch (error) {
    throw new ConfigError(
      `Cannot create GDSC cache directory: ${dir}`,
      `${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

export function gdscPaths(): GdscPaths {
  const root = process.env.BIOCLI_DATASETS_DIR ?? join(homedir(), '.biocli', 'datasets');
  const dir = join(root, 'gdsc');
  return {
    dir,
    compoundsCsv: join(dir, 'screened_compounds_rel_8.5.csv'),
    gdsc1Xlsx: join(dir, 'GDSC1_fitted_dose_response_27Oct23.xlsx'),
    gdsc2Xlsx: join(dir, 'GDSC2_fitted_dose_response_27Oct23.xlsx'),
    meta: join(dir, 'gdsc.meta.json'),
    index: join(dir, `gdsc.sensitivity-index.v${GDSC_INDEX_VERSION}.json`),
  };
}

async function downloadFile(ctx: HttpContext, url: string, path: string, minBytes: number): Promise<void> {
  const response = await ctx.fetch(url);
  if (!response.ok) {
    throw new ApiError(
      `Failed to download GDSC dataset file: HTTP ${response.status} ${response.statusText}`,
      url,
    );
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length < minBytes) {
    throw new ApiError(
      `Downloaded GDSC dataset file is unexpectedly small (${bytes.length} bytes)`,
      url,
    );
  }

  const tmp = `${path}.tmp-${process.pid}`;
  try {
    writeFileSync(tmp, bytes);
    renameSync(tmp, path);
  } catch (error) {
    try { if (existsSync(tmp)) unlinkSync(tmp); } catch { /* ignore */ }
    throw new ConfigError(
      `Failed to write GDSC dataset file: ${path}`,
      `${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function currentMetaFromFiles(paths: GdscPaths): GdscDownloadMeta {
  return {
    source: 'GDSC bulk downloads',
    release: GDSC_RELEASE,
    fetchedAt: new Date().toISOString(),
    staleAfterDays: DEFAULT_GDSC_STALE_AFTER_DAYS,
    indexVersion: GDSC_INDEX_VERSION,
    files: GDSC_FILES.map(file => {
      const path = paths[file.key];
      const stat = statSync(path);
      return {
        key: file.key,
        filename: file.filename,
        url: file.url,
        sizeBytes: stat.size,
        sha256: sha256OfFile(path),
      };
    }),
  };
}

export async function refreshGdscDataset(
  ctx: HttpContext,
  opts: { force?: boolean } = {},
): Promise<GdscDownloadMeta> {
  const paths = gdscPaths();
  ensureDir(paths.dir);

  const existing = readMeta(paths.meta);
  const complete = GDSC_FILES.every(file => existsSync(paths[file.key]));
  if (!opts.force && existing && complete) {
    return existing;
  }

  for (const file of GDSC_FILES) {
    const path = paths[file.key];
    if (!opts.force && existsSync(path)) continue;
    await downloadFile(ctx, file.url, path, file.minBytes);
  }

  const meta = currentMetaFromFiles(paths);
  writeJsonAtomic(paths.meta, meta);
  if (existsSync(paths.index)) {
    try { unlinkSync(paths.index); } catch { /* ignore */ }
  }
  _resetGdscSingleton();
  return meta;
}

function buildAliasIndex(drugs: Record<string, GdscDrugEntry>): Record<string, string[]> {
  const byAlias = new Map<string, Set<string>>();
  for (const [drugId, entry] of Object.entries(drugs)) {
    for (const alias of [entry.compound.drugName, ...entry.compound.synonyms]) {
      const normalized = normalizeAlias(alias);
      if (!normalized) continue;
      const bucket = byAlias.get(normalized) ?? new Set<string>();
      bucket.add(drugId);
      byAlias.set(normalized, bucket);
    }
  }
  return Object.fromEntries(
    [...byAlias.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([alias, ids]) => [alias, [...ids].sort()]),
  );
}

function csvRows(path: string): Array<Record<string, unknown>> {
  const workbook = xlsx.readFile(path, { dense: true, raw: false });
  const worksheet = workbook.Sheets[workbook.SheetNames[0]!];
  return xlsx.utils.sheet_to_json<Record<string, unknown>>(worksheet, {
    raw: false,
    defval: '',
  });
}

function workbookRows(path: string): Array<Record<string, unknown>> {
  const workbook = xlsx.readFile(path, { dense: true, raw: false });
  const worksheet = workbook.Sheets[workbook.SheetNames[0]!];
  return xlsx.utils.sheet_to_json<Record<string, unknown>>(worksheet, {
    raw: false,
    defval: '',
  });
}

function compoundFromRow(row: Record<string, unknown>): GdscCompound | null {
  const drugId = String(row.DRUG_ID ?? '').trim();
  const drugName = normalizeWhitespace(String(row.DRUG_NAME ?? ''));
  if (!drugId || !drugName) return null;
  const synonyms = String(row.SYNONYMS ?? '')
    .split(/[;,]/g)
    .map(value => normalizeWhitespace(value))
    .filter(Boolean)
    .filter((value, index, items) => items.indexOf(value) === index);
  return {
    drugId,
    drugName,
    synonyms,
    target: normalizeWhitespace(String(row.TARGET ?? '')) || undefined,
    targetPathway: normalizeWhitespace(String(row.TARGET_PATHWAY ?? '')) || undefined,
  };
}

function sortTissues(a: GdscTissueSummary, b: GdscTissueSummary): number {
  return b.rowCount - a.rowCount
    || ((a.bestZScore ?? Number.POSITIVE_INFINITY) - (b.bestZScore ?? Number.POSITIVE_INFINITY))
    || a.tissue.localeCompare(b.tissue);
}

function sortDatasets(a: GdscDatasetSummary, b: GdscDatasetSummary): number {
  return a.dataset.localeCompare(b.dataset);
}

function buildIndexFromFiles(paths: GdscPaths, meta: GdscDownloadMeta): GdscSensitivityIndex {
  const compoundsByDrugId = new Map<string, GdscCompound>();
  for (const row of csvRows(paths.compoundsCsv)) {
    const compound = compoundFromRow(row);
    if (!compound) continue;
    compoundsByDrugId.set(compound.drugId, compound);
  }

  const byDrugId = new Map<string, MutableDrugEntry>();

  function ensureDrugEntry(drugId: string, fallbackName?: string, fallbackTarget?: string, fallbackPathway?: string): MutableDrugEntry {
    const existing = byDrugId.get(drugId);
    if (existing) return existing;
    const compound = compoundsByDrugId.get(drugId) ?? {
      drugId,
      drugName: normalizeWhitespace(fallbackName ?? '') || `Drug ${drugId}`,
      synonyms: [],
      target: normalizeWhitespace(fallbackTarget ?? '') || undefined,
      targetPathway: normalizeWhitespace(fallbackPathway ?? '') || undefined,
    };
    const created: MutableDrugEntry = {
      compound,
      totalRowCount: 0,
      strongSensitiveCount: 0,
      datasets: new Map(),
    };
    byDrugId.set(drugId, created);
    return created;
  }

  function ingestDatasetRows(dataset: 'GDSC1' | 'GDSC2', path: string): void {
    const rows = workbookRows(path);
    for (const row of rows) {
      const drugId = String(row.DRUG_ID ?? '').trim();
      if (!drugId) continue;

      const entry = ensureDrugEntry(
        drugId,
        String(row.DRUG_NAME ?? ''),
        String(row.PUTATIVE_TARGET ?? ''),
        String(row.PATHWAY_NAME ?? ''),
      );

      const datasetSummary = entry.datasets.get(dataset) ?? {
        dataset,
        rowCount: 0,
        strongSensitiveCount: 0,
        topHits: [],
        tissues: new Map<string, MutableTissueSummary>(),
      };
      entry.datasets.set(dataset, datasetSummary);
      entry.totalRowCount += 1;
      datasetSummary.rowCount += 1;

      const zScore = parseNumber(row.Z_SCORE);
      const auc = parseNumber(row.AUC);
      const lnIc50 = parseNumber(row.LN_IC50);
      const tissue = normalizeWhitespace(String(row.TCGA_DESC ?? '')) || 'Unknown';
      const tissueKey = tissue.toLowerCase();
      const tissueSummary = datasetSummary.tissues.get(tissueKey) ?? {
        tissue,
        rowCount: 0,
        strongSensitiveCount: 0,
        topHits: [],
      };
      datasetSummary.tissues.set(tissueKey, tissueSummary);
      tissueSummary.rowCount += 1;

      const hit: GdscSensitivityHit = {
        dataset,
        cellLineName: normalizeWhitespace(String(row.CELL_LINE_NAME ?? '')) || 'Unknown',
        sangerModelId: normalizeWhitespace(String(row.SANGER_MODEL_ID ?? '')) || undefined,
        tissue,
        zScore,
        auc,
        lnIc50,
      };

      if (zScore !== undefined) {
        if (datasetSummary.bestZScore === undefined || zScore < datasetSummary.bestZScore) {
          datasetSummary.bestZScore = zScore;
        }
        if (tissueSummary.bestZScore === undefined || zScore < tissueSummary.bestZScore) {
          tissueSummary.bestZScore = zScore;
        }
        if (zScore <= -1) {
          entry.strongSensitiveCount += 1;
          datasetSummary.strongSensitiveCount += 1;
          tissueSummary.strongSensitiveCount += 1;
        }
      }

      pushTopHit(datasetSummary.topHits, hit, MAX_DATASET_TOP_HITS);
      pushTopHit(tissueSummary.topHits, hit, MAX_TISSUE_TOP_HITS);
    }
  }

  ingestDatasetRows('GDSC1', paths.gdsc1Xlsx);
  ingestDatasetRows('GDSC2', paths.gdsc2Xlsx);

  const drugs: Record<string, GdscDrugEntry> = {};
  for (const [drugId, entry] of [...byDrugId.entries()].sort((a, b) => Number(a[0]) - Number(b[0]))) {
    drugs[drugId] = {
      compound: entry.compound,
      totalRowCount: entry.totalRowCount,
      strongSensitiveCount: entry.strongSensitiveCount,
      datasets: [...entry.datasets.values()]
        .map(dataset => ({
          dataset: dataset.dataset,
          rowCount: dataset.rowCount,
          strongSensitiveCount: dataset.strongSensitiveCount,
          bestZScore: dataset.bestZScore,
          topHits: dataset.topHits,
          tissues: [...dataset.tissues.values()]
            .map(tissue => ({
              tissue: tissue.tissue,
              rowCount: tissue.rowCount,
              strongSensitiveCount: tissue.strongSensitiveCount,
              bestZScore: tissue.bestZScore,
              topHits: tissue.topHits,
            }))
            .sort(sortTissues),
        }))
        .sort(sortDatasets),
    };
  }

  return {
    meta,
    aliases: buildAliasIndex(drugs),
    drugs,
  };
}

function shouldRebuildIndex(paths: GdscPaths, meta: GdscDownloadMeta): boolean {
  if (!existsSync(paths.index)) return true;
  const indexMtime = statSync(paths.index).mtimeMs;
  if (meta.indexVersion !== GDSC_INDEX_VERSION) return true;
  return GDSC_FILES.some(file => statSync(paths[file.key]).mtimeMs > indexMtime);
}

async function buildOrReadIndex(ctx: HttpContext): Promise<GdscSensitivityIndex> {
  const paths = gdscPaths();
  ensureDir(paths.dir);
  let meta = readMeta(paths.meta);
  const complete = GDSC_FILES.every(file => existsSync(paths[file.key]));
  if (!complete || !meta) {
    meta = await refreshGdscDataset(ctx);
  }

  if (shouldRebuildIndex(paths, meta)) {
    const built = buildIndexFromFiles(paths, meta);
    writeJsonAtomic(paths.index, built);
    return built;
  }

  const raw = readFileSync(paths.index, 'utf-8');
  return JSON.parse(raw) as GdscSensitivityIndex;
}

let _loadPromise: Promise<GdscSensitivityIndex> | null = null;

export function loadGdscSensitivityIndex(ctx: HttpContext): Promise<GdscSensitivityIndex> {
  if (_loadPromise) return _loadPromise;
  _loadPromise = buildOrReadIndex(ctx).then((index) => {
    const ageMs = Date.now() - new Date(index.meta.fetchedAt).getTime();
    const ageDays = Math.floor(ageMs / 86_400_000);
    if (ageDays > (index.meta.staleAfterDays ?? DEFAULT_GDSC_STALE_AFTER_DAYS)) {
      console.error(
        `[biocli] Warning: GDSC cache is ${ageDays} days old (stale after ${index.meta.staleAfterDays}). ` +
        'Delete ~/.biocli/datasets/gdsc or refresh via a future GDSC command to update.',
      );
    }
    return index;
  }).catch((error) => {
    _loadPromise = null;
    throw error;
  });
  return _loadPromise;
}

export function findGdscDrugEntriesByName(
  index: GdscSensitivityIndex,
  name: string,
): GdscDrugEntry[] {
  const alias = normalizeAlias(name);
  if (!alias) return [];
  return (index.aliases[alias] ?? [])
    .map(drugId => index.drugs[drugId])
    .filter((entry): entry is GdscDrugEntry => Boolean(entry));
}

export function _resetGdscSingleton(): void {
  _loadPromise = null;
}
