/**
 * Unimod — Reference dataset loader, parser, and query index.
 *
 * Unimod (https://www.unimod.org) is the mass-spectrometry community's
 * canonical dictionary of protein post-translational modifications. Unlike
 * biocli's live REST backends (NCBI, UniProt, …), Unimod is distributed only
 * as a static XML dump that is downloaded once, cached on disk, and queried
 * in memory. This is the first instance of the "Reference Dataset" pattern.
 *
 * Design decisions (see /home/yangfei/.claude/plans/linear-questing-lampson.md):
 *
 *   • Downloads use `fetchWithIPv4Fallback` directly — NOT HttpContext.
 *     The HttpContext path silently falls back to NCBI for unknown database
 *     ids, which would inject NCBI auth into unimod.org URLs.
 *
 *   • Stale policy: `staleAfterDays` (default 90). Expired cache emits a
 *     stderr warning but IS STILL USED. Refresh must be explicit via
 *     `biocli unimod refresh`.
 *
 *   • Atomic writes: tmp file → rename. A multi-MB download must not leave
 *     a truncated file on Ctrl-C.
 *
 *   • Singleton load: `loadUnimod()` memoizes a promise with catch-reset so
 *     transient failures don't pin a rejected promise forever.
 *
 *   • Test isolation: honor `BIOCLI_DATASETS_DIR` env var so tests use a
 *     temp dir and dev machines with a real cache don't bleed into CI.
 *
 *   • Attribution: Design Science License requires attribution. Commands
 *     emit UNIMOD_ATTRIBUTION to stderr so stdout stays clean for `jq`.
 */

import { homedir } from 'node:os';
import { join } from 'node:path';
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, unlinkSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { XMLParser } from 'fast-xml-parser';
import { ApiError, CliError, CommandExecutionError, ConfigError, EXIT_CODES } from '../errors.js';
import { fetchWithIPv4Fallback } from '../http-dispatcher.js';

// ── Constants ───────────────────────────────────────────────────────────────

/** Canonical Unimod XML download URL (logical structure, not relational). */
export const UNIMOD_URL = 'https://www.unimod.org/xml/unimod.xml';

/** Attribution line emitted to stderr by every unimod command. */
export const UNIMOD_ATTRIBUTION =
  'Data: Unimod (https://www.unimod.org), Design Science License.';

/** Default staleness threshold in days. Beyond this, doctor shows a warning. */
export const DEFAULT_STALE_AFTER_DAYS = 90;

/** Minimum acceptable mod count after parsing (sanity check on download). */
export const MIN_MOD_COUNT = 500;

/** Minimum acceptable body length in bytes (sanity check on download). */
export const MIN_BODY_BYTES = 100_000;

// ── Types ───────────────────────────────────────────────────────────────────

/** A single specificity entry within a Unimod modification. */
export interface UnimodSpecificity {
  /** Amino acid single letter (e.g. "S") or "N-term" / "C-term". */
  site: string;
  /** One of: Anywhere, Any N-term, Any C-term, Protein N-term, Protein C-term. */
  position: string;
  /** E.g. "Post-translational", "Chemical derivative", "Isotopic label". */
  classification: string;
  /** Whether this specificity is marked hidden="1" (usually rare or deprecated). */
  hidden: boolean;
  /** Monoisotopic mass of primary neutral loss, if any. */
  neutralLossMono?: number;
  /** Composition string of primary neutral loss, if any (e.g. "H(3) O(4) P"). */
  neutralLossComposition?: string;
}

/** Cross-reference to an external database (RESID, PubMed, etc.). */
export interface UnimodXref {
  source: string;
  text: string;
  url?: string;
}

/** A single Unimod modification entry. */
export interface UnimodMod {
  /** Numeric record_id from the XML (e.g. 21 for Phospho). */
  recordId: number;
  /** Formatted accession ("UNIMOD:21"). */
  accession: string;
  /** Short name / title (e.g. "Phospho"). Doubles as the PSI-MS / Interim name. */
  title: string;
  /** Full descriptive name (e.g. "Phosphorylation"). */
  fullName: string;
  /** Whether the entry has been approved by Unimod curators. */
  approved: boolean;
  /** Monoisotopic mass of the modification (Da). */
  monoMass: number;
  /** Average mass of the modification (Da). */
  avgMass: number;
  /** Composition string (e.g. "H O(3) P"). */
  composition: string;
  /** All specificities. Each mod can have multiple (e.g. Phospho has 9). */
  specificities: UnimodSpecificity[];
  /** Alternative names for substring search. */
  altNames: string[];
  /** Cross-references to RESID, PubMed, etc. */
  xrefs: UnimodXref[];
}

/** Metadata about a loaded index — also persisted in unimod.meta.json. */
export interface UnimodParseMeta {
  /** Upstream source URL the data was fetched from. */
  source: string;
  /** ISO timestamp of when the XML was downloaded. */
  fetchedAt: string;
  /** Number of modifications parsed. */
  modCount: number;
  /** Staleness threshold in days (doctor warns beyond this). */
  staleAfterDays: number;
  /** SHA-256 of the raw XML body (integrity check). */
  sha256?: string;
}

/**
 * In-memory index over parsed Unimod data.
 *
 * Intentionally minimal: a flat `mods` array plus two exact-lookup maps.
 * Linear scans on ~1500-2500 entries are <1 ms — pre-optimizing with
 * sorted arrays or prefix tries would be a premature complication.
 */
export interface UnimodIndex {
  /** All mods in parse order. Primary data source. */
  mods: UnimodMod[];
  /** Exact lookup by numeric record_id (21 → Phospho). */
  byRecordId: Map<number, UnimodMod>;
  /** Exact lookup by lowercased title ("phospho" → Phospho). */
  byTitleLower: Map<string, UnimodMod>;
  /** All classifications observed in the dataset (sorted, deduped). */
  classifications: string[];
  /** All site values observed (amino acids + N-term/C-term, sorted, deduped). */
  sites: string[];
  /** Parse/download metadata. */
  parseMeta: UnimodParseMeta;
}

/** File paths for the Unimod cache. */
export interface UnimodPaths {
  /** Directory containing xml + meta files. */
  dir: string;
  /** Path to the cached XML file. */
  xml: string;
  /** Path to the metadata JSON file. */
  meta: string;
}

// ── Path helper ─────────────────────────────────────────────────────────────

/**
 * Resolve the Unimod cache paths.
 *
 * Honors the `BIOCLI_DATASETS_DIR` environment variable so tests can
 * redirect to a temp dir without mocking the filesystem.
 */
export function unimodPaths(): UnimodPaths {
  const dir = process.env.BIOCLI_DATASETS_DIR
    ?? join(homedir(), '.biocli', 'datasets');
  return {
    dir,
    xml: join(dir, 'unimod.xml'),
    meta: join(dir, 'unimod.meta.json'),
  };
}

// ── XML parser (independent from src/xml-parser.ts) ────────────────────────

/**
 * Tags that must always be arrays, even when only one appears.
 *
 * fast-xml-parser by default collapses single-element repeated tags into
 * bare objects. For Unimod we need stable array shapes across all mods,
 * otherwise code like `mod.specificity[0]` breaks for mods with 1 site.
 *
 * Note: we use `removeNSPrefix: true` below, so tag names have no
 * `umod:` prefix inside the isArray callback.
 */
const UNIMOD_ARRAY_TAGS = new Set([
  'mod',
  'specificity',
  'alt_name',
  'xref',
  'element',
  'NeutralLoss',
]);

/** Build a fresh XMLParser tuned for Unimod. */
function makeUnimodParser(): XMLParser {
  return new XMLParser({
    // Strip the umod: namespace so we can access tags as `.mod` / `.specificity`
    removeNSPrefix: true,
    // Keep attributes under `@_` prefix (mod.@_record_id, delta.@_mono_mass)
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    textNodeName: '#text',
    // Convert numeric attribute values to numbers automatically
    parseAttributeValue: true,
    parseTagValue: true,
    trimValues: true,
    isArray: (name: string) => UNIMOD_ARRAY_TAGS.has(name),
  });
}

// ── Parser helpers ──────────────────────────────────────────────────────────

type XmlNode = Record<string, unknown>;

/** Safely cast an unknown to a record, or return empty object. */
function asRecord(v: unknown): XmlNode {
  return v && typeof v === 'object' ? (v as XmlNode) : {};
}

/** Safely cast an unknown to an array, or return empty array. */
function asArray<T = XmlNode>(v: unknown): T[] {
  if (Array.isArray(v)) return v as T[];
  if (v === undefined || v === null || v === '') return [];
  return [v as T];
}

/** Coerce any value to a trimmed string. */
function asString(v: unknown): string {
  if (v === undefined || v === null) return '';
  if (typeof v === 'string') return v.trim();
  if (typeof v === 'object') {
    const rec = v as XmlNode;
    if (typeof rec['#text'] === 'string') return rec['#text'].trim();
  }
  return String(v).trim();
}

/** Coerce any value to a finite number, or NaN if unparseable. */
function asNumber(v: unknown): number {
  if (typeof v === 'number') return v;
  if (typeof v === 'string') {
    const n = Number(v);
    return Number.isFinite(n) ? n : NaN;
  }
  return NaN;
}

/**
 * Extract the "primary" neutral loss from a specificity's NeutralLoss list.
 * Unimod frequently stores a placeholder `mono_mass="0"` entry alongside the
 * real one; we want the first entry with mono_mass > 0.
 */
function extractNeutralLoss(rawSpec: XmlNode): { mono?: number; composition?: string } {
  const losses = asArray(rawSpec.NeutralLoss);
  for (const loss of losses) {
    const l = asRecord(loss);
    const mono = asNumber(l['@_mono_mass']);
    if (Number.isFinite(mono) && mono > 0) {
      const comp = asString(l['@_composition']);
      return { mono, composition: comp || undefined };
    }
  }
  return {};
}

/** Parse one `<umod:specificity>` node into our typed form. */
function parseSpecificity(raw: XmlNode): UnimodSpecificity {
  const nl = extractNeutralLoss(raw);
  return {
    site: asString(raw['@_site']),
    position: asString(raw['@_position']) || 'Anywhere',
    classification: asString(raw['@_classification']),
    hidden: asString(raw['@_hidden']) === '1' || raw['@_hidden'] === 1 || raw['@_hidden'] === true,
    neutralLossMono: nl.mono,
    neutralLossComposition: nl.composition,
  };
}

/** Parse one `<umod:mod>` node into a typed UnimodMod. */
function parseMod(raw: XmlNode): UnimodMod | null {
  const recordId = asNumber(raw['@_record_id']);
  if (!Number.isFinite(recordId)) return null;

  const delta = asRecord(raw.delta);
  const monoMass = asNumber(delta['@_mono_mass']);
  const avgMass = asNumber(delta['@_avge_mass']);
  if (!Number.isFinite(monoMass)) return null;

  const specificities = asArray(raw.specificity).map(s => parseSpecificity(asRecord(s)));
  const altNames = asArray(raw.alt_name).map(v => asString(v)).filter(Boolean);
  const xrefs = asArray(raw.xref).map(x => {
    const r = asRecord(x);
    const url = asString(r.url);
    return {
      source: asString(r.source),
      text: asString(r.text),
      url: url || undefined,
    };
  }).filter(x => x.source || x.text);

  return {
    recordId,
    accession: `UNIMOD:${recordId}`,
    title: asString(raw['@_title']),
    fullName: asString(raw['@_full_name']),
    approved: asString(raw['@_approved']) === '1' || raw['@_approved'] === 1 || raw['@_approved'] === true,
    monoMass,
    avgMass: Number.isFinite(avgMass) ? avgMass : monoMass,
    composition: asString(delta['@_composition']),
    specificities,
    altNames,
    xrefs,
  };
}

// ── Public parser entry point ──────────────────────────────────────────────

/**
 * Parse a Unimod XML document into an in-memory index.
 * Pure function — no I/O, no network. Safe to call from tests with a fixture.
 */
export function parseUnimodXml(xml: string, source?: string): UnimodIndex {
  if (typeof xml !== 'string' || xml.length === 0) {
    throw new CommandExecutionError('parseUnimodXml: empty or non-string input');
  }

  let parsed: XmlNode;
  try {
    parsed = makeUnimodParser().parse(xml) as XmlNode;
  } catch (err) {
    throw new CommandExecutionError(
      `Failed to parse Unimod XML: ${err instanceof Error ? err.message : String(err)}`,
      'The file may be corrupt. Try running "biocli unimod refresh".',
    );
  }

  const root = asRecord(parsed.unimod);
  const modifications = asRecord(root.modifications);
  const rawMods = asArray(modifications.mod);

  const mods: UnimodMod[] = [];
  const byRecordId = new Map<number, UnimodMod>();
  const byTitleLower = new Map<string, UnimodMod>();
  const classificationSet = new Set<string>();
  const siteSet = new Set<string>();

  for (const rawMod of rawMods) {
    const mod = parseMod(asRecord(rawMod));
    if (!mod) continue;
    mods.push(mod);
    byRecordId.set(mod.recordId, mod);
    if (mod.title) {
      byTitleLower.set(mod.title.toLowerCase(), mod);
    }
    for (const spec of mod.specificities) {
      if (spec.classification) classificationSet.add(spec.classification);
      if (spec.site) siteSet.add(spec.site);
    }
  }

  return {
    mods,
    byRecordId,
    byTitleLower,
    classifications: [...classificationSet].sort(),
    sites: [...siteSet].sort(),
    parseMeta: {
      source: source ?? UNIMOD_URL,
      fetchedAt: new Date().toISOString(),
      modCount: mods.length,
      staleAfterDays: DEFAULT_STALE_AFTER_DAYS,
    },
  };
}

// ── Loader + atomic refresh ─────────────────────────────────────────────────

/** Ensure the cache directory exists, throwing a ConfigError on failure. */
function ensureCacheDir(dir: string): void {
  try {
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  } catch (err) {
    throw new ConfigError(
      `Cannot create Unimod cache directory: ${dir}`,
      `Check permissions on ${dir}. Set BIOCLI_DATASETS_DIR to override the location. (${err instanceof Error ? err.message : String(err)})`,
    );
  }
}

/** Read the meta.json file, or return null if missing/unparseable. */
function readMeta(path: string): UnimodParseMeta | null {
  if (!existsSync(path)) return null;
  try {
    const raw = readFileSync(path, 'utf-8');
    const parsed = JSON.parse(raw) as UnimodParseMeta;
    if (!parsed.fetchedAt || typeof parsed.modCount !== 'number') return null;
    return parsed;
  } catch {
    return null;
  }
}

/** Write meta.json atomically (tmp + rename). */
function writeMeta(path: string, meta: UnimodParseMeta): void {
  const tmp = `${path}.tmp-${process.pid}`;
  writeFileSync(tmp, JSON.stringify(meta, null, 2) + '\n', 'utf-8');
  renameSync(tmp, path);
}

/**
 * Download and install the Unimod XML dataset.
 *
 * With `force: false` (default), does nothing if meta.json already exists.
 * With `force: true`, always re-downloads.
 *
 * Uses atomic write (tmp + rename) to avoid leaving truncated files if
 * the download is interrupted (Ctrl-C, network drop, disk full).
 *
 * Post-download sanity checks:
 *   1. Body starts with `<?xml` (not an HTML error page)
 *   2. Body length > 100 KB (not truncated)
 *   3. Parser returns ≥ 500 mods (not corrupt)
 */
export async function refreshUnimod(opts: { force?: boolean } = {}): Promise<UnimodParseMeta> {
  const paths = unimodPaths();
  const force = opts.force === true;

  // Short-circuit: if not forced and already installed, just return existing meta.
  if (!force) {
    const existing = readMeta(paths.meta);
    if (existing) return existing;
  }

  ensureCacheDir(paths.dir);

  // ── Fetch ──
  let response: Response;
  try {
    response = await fetchWithIPv4Fallback(UNIMOD_URL);
  } catch (err) {
    throw new ApiError(
      `Unimod download failed: ${err instanceof Error ? err.message : String(err)}`,
      'Check your network connection. Unimod is served from https://www.unimod.org/xml/unimod.xml.',
    );
  }

  if (!response.ok) {
    throw new ApiError(
      `Unimod download failed: HTTP ${response.status} ${response.statusText}`,
      'The upstream Unimod server may be temporarily unavailable. Try again later.',
    );
  }

  const body = await response.text();

  // ── Sanity checks ──
  if (body.length < MIN_BODY_BYTES) {
    throw new ApiError(
      `Unimod download too small: ${body.length} bytes (expected > ${MIN_BODY_BYTES})`,
      'The upstream may be serving a maintenance page. Try again later.',
    );
  }
  if (!body.trimStart().startsWith('<?xml')) {
    throw new ApiError(
      'Unimod download is not XML (missing <?xml prologue)',
      'The upstream may be returning an HTML error page. Try again later.',
    );
  }

  // Parse + validate before committing to disk
  let index: UnimodIndex;
  try {
    index = parseUnimodXml(body, UNIMOD_URL);
  } catch (err) {
    throw new ApiError(
      `Unimod XML parse failed during refresh: ${err instanceof Error ? err.message : String(err)}`,
      'The downloaded file may be corrupt. Try again.',
    );
  }

  if (index.mods.length < MIN_MOD_COUNT) {
    throw new ApiError(
      `Unimod dataset only contains ${index.mods.length} mods (expected ≥ ${MIN_MOD_COUNT})`,
      'The download may be incomplete. Try again.',
    );
  }

  // ── Atomic write ──
  const sha256 = createHash('sha256').update(body).digest('hex');
  const xmlTmp = `${paths.xml}.tmp-${process.pid}`;
  try {
    writeFileSync(xmlTmp, body, 'utf-8');
    renameSync(xmlTmp, paths.xml);
  } catch (err) {
    // Best-effort cleanup of the tmp file if rename failed.
    try { if (existsSync(xmlTmp)) unlinkSync(xmlTmp); } catch { /* ignore */ }
    throw new ConfigError(
      `Failed to write Unimod cache: ${err instanceof Error ? err.message : String(err)}`,
      `Check permissions on ${paths.dir}.`,
    );
  }

  const meta: UnimodParseMeta = {
    source: UNIMOD_URL,
    fetchedAt: new Date().toISOString(),
    modCount: index.mods.length,
    staleAfterDays: DEFAULT_STALE_AFTER_DAYS,
    sha256,
  };
  writeMeta(paths.meta, meta);

  // Invalidate any in-memory singleton so the next loadUnimod() re-reads.
  _resetUnimodSingleton();

  return meta;
}

// ── In-memory singleton loader ──────────────────────────────────────────────

let _loadPromise: Promise<UnimodIndex> | null = null;

/** Internal: do the actual disk read + parse. */
async function doLoad(): Promise<UnimodIndex> {
  const paths = unimodPaths();
  const meta = readMeta(paths.meta);
  if (!meta) {
    throw new CliError(
      'MISSING_DATASET',
      'Unimod dataset not installed.',
      'Run "biocli unimod fetch" to download the Unimod modification dictionary.',
      EXIT_CODES.GENERIC_ERROR,
    );
  }
  if (!existsSync(paths.xml)) {
    throw new CliError(
      'MISSING_DATASET',
      `Unimod meta.json exists but XML is missing: ${paths.xml}`,
      'Run "biocli unimod refresh" to re-download.',
      EXIT_CODES.GENERIC_ERROR,
    );
  }

  let xml: string;
  try {
    xml = readFileSync(paths.xml, 'utf-8');
  } catch (err) {
    throw new ConfigError(
      `Cannot read Unimod cache file: ${paths.xml}`,
      `${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const index = parseUnimodXml(xml, meta.source);
  // Propagate meta fields so doctor/stale checks see the stored fetchedAt, not "now".
  index.parseMeta = meta;

  // Emit stale warning on stderr without blocking the call.
  const ageMs = Date.now() - new Date(meta.fetchedAt).getTime();
  const ageDays = Math.floor(ageMs / 86_400_000);
  const staleAfter = meta.staleAfterDays ?? DEFAULT_STALE_AFTER_DAYS;
  if (ageDays > staleAfter) {
    console.error(
      `[biocli] Warning: Unimod cache is ${ageDays} days old (stale after ${staleAfter}). ` +
      `Run "biocli unimod refresh" to update.`,
    );
  }

  return index;
}

/**
 * Load the Unimod index from disk (singleton with catch-reset).
 *
 * On first call: reads `~/.biocli/datasets/unimod.xml`, parses it, caches
 * the index in memory. Subsequent calls return the cached index.
 *
 * On failure the singleton is reset so the next call retries fresh —
 * prevents a transient error from pinning a rejected promise for the
 * process lifetime.
 *
 * Throws `CliError('MISSING_DATASET')` if the dataset has not been
 * installed — user must run `biocli unimod fetch`.
 */
export function loadUnimod(): Promise<UnimodIndex> {
  if (_loadPromise) return _loadPromise;
  _loadPromise = doLoad().catch(err => {
    _loadPromise = null;
    throw err;
  });
  return _loadPromise;
}

/**
 * Reset the in-memory singleton — for tests only.
 * Production code should never call this except after refreshUnimod().
 */
export function _resetUnimodSingleton(): void {
  _loadPromise = null;
}
