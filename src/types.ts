/**
 * Core type definitions for biocli.
 *
 * HttpContext is the primary execution context passed to every command
 * function. It wraps database-aware HTTP fetching with built-in rate
 * limiting, authentication injection, and response parsing.
 */

import { getVersion } from './version.js';

// ── Result metadata ────────────────────────────────────────────────────────────

/** Metadata that commands can attach to results for the rendering layer. */
export interface ResultMeta {
  /** Total matching items from the API (e.g. esearch count), for "3 of N" display. */
  totalCount?: number;
  /** The original search query, used for keyword highlighting. */
  query?: string;
}

/**
 * Wraps a result array with optional display metadata.
 *
 * Commands return this via `withMeta(rows, meta)` — the commander-adapter
 * extracts the meta and passes it to the output renderer.
 */
export interface ResultWithMeta<T = unknown> {
  readonly __resultMeta: true;
  rows: T[];
  meta: ResultMeta;
}

/** Wrap command results with display metadata. */
export function withMeta<T>(rows: T[], meta: ResultMeta): ResultWithMeta<T> {
  return { __resultMeta: true as const, rows, meta };
}

/** Type guard for ResultWithMeta. */
export function hasResultMeta(v: unknown): v is ResultWithMeta {
  return typeof v === 'object' && v !== null && (v as ResultWithMeta).__resultMeta === true;
}

// ── Agent-first result schema ──────────────────────────────────────────────────

export const BIOCLI_COMPLETENESS_VALUES = ['complete', 'partial', 'degraded'] as const;
export type BiocliCompleteness = typeof BIOCLI_COMPLETENESS_VALUES[number];

export interface BiocliProvenanceSource {
  /** Human-readable source label (for example, NCBI Gene or UniProt). */
  source: string;
  /** Canonical landing page or API root for this source. */
  url?: string;
  /** Database release when known (for example, UniProt 2026_02). */
  databaseRelease?: string;
  /** API version or protocol family when known. */
  apiVersion?: string;
  /** Canonical identifiers for the records used from this source. */
  recordIds?: string[];
  /** Optional citation DOI for the source database. */
  doi?: string;
}

export interface BiocliProvenance {
  /** ISO timestamp for when this result was assembled. */
  retrievedAt: string;
  /** Structured provenance per contributing source. */
  sources: BiocliProvenanceSource[];
}

export interface BiocliProvenanceOverride extends Partial<Omit<BiocliProvenanceSource, 'source'>> {
  source: string;
}

const SOURCE_DEFAULTS: Record<string, Omit<BiocliProvenanceSource, 'source' | 'recordIds'>> = {
  'cBioPortal': { url: 'https://www.cbioportal.org/', apiVersion: 'REST API' },
  'ClinVar': { url: 'https://www.ncbi.nlm.nih.gov/clinvar/', apiVersion: 'E-utilities' },
  'Enrichr': { url: 'https://maayanlab.cloud/Enrichr/', apiVersion: 'REST' },
  'Ensembl VEP': { url: 'https://rest.ensembl.org', apiVersion: 'REST' },
  'GEO': { url: 'https://www.ncbi.nlm.nih.gov/geo/', apiVersion: 'E-utilities' },
  'GDSC': { url: 'https://www.cancerrxgene.org/downloads/bulk_download', apiVersion: 'Bulk release' },
  'KEGG': { url: 'https://rest.kegg.jp', apiVersion: 'REST' },
  'NCBI Gene': { url: 'https://www.ncbi.nlm.nih.gov/gene/', apiVersion: 'E-utilities' },
  'Open Targets': { url: 'https://platform.opentargets.org/', apiVersion: 'GraphQL API v4' },
  'PRIDE': { url: 'https://www.ebi.ac.uk/pride/archive/', apiVersion: 'Archive v3' },
  'ProteomeXchange': { url: 'https://proteomecentral.proteomexchange.org', apiVersion: 'PROXI' },
  'PubMed': { url: 'https://pubmed.ncbi.nlm.nih.gov/', apiVersion: 'E-utilities' },
  'SRA': { url: 'https://www.ncbi.nlm.nih.gov/sra', apiVersion: 'E-utilities' },
  'STRING': { url: 'https://string-db.org/api', apiVersion: 'JSON API' },
  'UniProt': { url: 'https://rest.uniprot.org/uniprotkb', apiVersion: 'REST' },
  'dbSNP': { url: 'https://www.ncbi.nlm.nih.gov/snp/', apiVersion: 'E-utilities' },
};

const SOURCE_ID_KEYS: Record<string, string[]> = {
  'ClinVar': ['clinvarAccession'],
  'Ensembl VEP': ['ensemblGeneId', 'ensemblTranscriptId'],
  'GEO': ['dataset'],
  'KEGG': ['keggId'],
  'NCBI Gene': ['ncbiGeneId', 'geneId'],
  'Open Targets': ['ensemblGeneId'],
  'PRIDE': ['pxd'],
  'ProteomeXchange': ['pxd'],
  'PubMed': ['pmid'],
  'SRA': ['dataset'],
  'UniProt': ['uniprotAccession'],
  'dbSNP': ['rsId'],
};

function uniqueStrings(values: Iterable<string | undefined>): string[] {
  const seen = new Set<string>();
  const items: string[] = [];
  for (const value of values) {
    const normalized = typeof value === 'string' ? value.trim() : '';
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    items.push(normalized);
  }
  return items;
}

function recordSpecificUrl(source: string, recordIds: string[]): string | undefined {
  if (recordIds.length !== 1) return undefined;
  const [id] = recordIds;
  switch (source) {
    case 'GEO':
      return `https://www.ncbi.nlm.nih.gov/geo/query/acc.cgi?acc=${encodeURIComponent(id)}`;
    case 'KEGG':
      return `https://www.kegg.jp/entry/${encodeURIComponent(id)}`;
    case 'NCBI Gene':
      return `https://www.ncbi.nlm.nih.gov/gene/${encodeURIComponent(id)}`;
    case 'Open Targets':
      return `https://platform.opentargets.org/target/${encodeURIComponent(id)}`;
    case 'PRIDE':
      return `https://www.ebi.ac.uk/pride/archive/projects/${encodeURIComponent(id)}`;
    case 'ProteomeXchange':
      return `https://proteomecentral.proteomexchange.org/cgi/GetDataset?ID=${encodeURIComponent(id)}`;
    case 'PubMed':
      return `https://pubmed.ncbi.nlm.nih.gov/${encodeURIComponent(id)}/`;
    case 'SRA':
      return `https://www.ncbi.nlm.nih.gov/sra/?term=${encodeURIComponent(id)}`;
    case 'UniProt':
      return `https://www.uniprot.org/uniprotkb/${encodeURIComponent(id)}`;
    case 'dbSNP':
      return `https://www.ncbi.nlm.nih.gov/snp/${encodeURIComponent(id)}`;
    default:
      return undefined;
  }
}

function recordIdsForSource(source: string, ids: Record<string, string>, override?: BiocliProvenanceOverride): string[] {
  const inferred = (SOURCE_ID_KEYS[source] ?? []).map(key => ids[key]);
  const manual = override?.recordIds ?? [];
  return uniqueStrings([...inferred, ...manual]);
}

function buildProvenanceSource(
  source: string,
  ids: Record<string, string>,
  override?: BiocliProvenanceOverride,
): BiocliProvenanceSource {
  const defaults = SOURCE_DEFAULTS[source] ?? {};
  const recordIds = recordIdsForSource(source, ids, override);
  const entry: BiocliProvenanceSource = {
    source,
    ...defaults,
    ...override,
  };
  if (!entry.url) {
    entry.url = recordSpecificUrl(source, recordIds);
  } else if (recordIds.length === 1) {
    entry.url = recordSpecificUrl(source, recordIds) ?? entry.url;
  }
  if (recordIds.length > 0) {
    entry.recordIds = recordIds;
  } else {
    delete entry.recordIds;
  }
  return entry;
}

export function buildBiocliProvenance(opts: {
  queriedAt: string;
  ids?: Record<string, string>;
  sources?: string[];
  provenance?: BiocliProvenanceOverride[];
}): BiocliProvenance {
  const ids = opts.ids ?? {};
  const overrides = opts.provenance ?? [];
  const overrideMap = new Map(overrides.map(item => [item.source, item] as const));
  const sourceNames = uniqueStrings([
    ...(opts.sources ?? []),
    ...overrides.map(item => item.source),
  ]);

  return {
    retrievedAt: opts.queriedAt,
    sources: sourceNames.map(source => buildProvenanceSource(source, ids, overrideMap.get(source))),
  };
}

export function deriveBiocliCompleteness(
  sources: string[],
  warnings: string[],
  override?: BiocliCompleteness,
): BiocliCompleteness {
  if (override) return override;
  if (sources.length === 0) return 'degraded';
  if (warnings.length === 0) return 'complete';
  return 'partial';
}

/**
 * Standard result envelope for aggregation/workflow commands.
 *
 * Every high-level biocli command should return this shape so that
 * AI agents and downstream scripts can consume results reliably.
 */
export interface BiocliResult<T = unknown> {
  /** biocli version that produced this envelope. */
  biocliVersion: string;
  /** Primary result data. */
  data: T;
  /** Cross-database identifiers for the queried entity. */
  ids: Record<string, string>;
  /** Which databases contributed data. */
  sources: string[];
  /** Non-fatal issues: partial failures, ambiguous matches, missing fields. */
  warnings: string[];
  /** ISO timestamp of when the query was executed. */
  queriedAt: string;
  /** Organism context (scientific name). */
  organism?: string;
  /** The original query input. */
  query: string;
  /** Whether the result is complete, partial, or degraded. */
  completeness: BiocliCompleteness;
  /** Structured provenance for contributing sources. */
  provenance: BiocliProvenance;
}

/** Create a BiocliResult envelope. */
export function wrapResult<T>(
  data: T,
  opts: {
    ids?: Record<string, string>;
    sources?: string[];
    warnings?: string[];
    organism?: string;
    query: string;
    completeness?: BiocliCompleteness;
    provenance?: BiocliProvenanceOverride[];
  },
): BiocliResult<T> {
  const queriedAt = new Date().toISOString();
  const ids = opts.ids ?? {};
  const sources = uniqueStrings([
    ...(opts.sources ?? []),
    ...(opts.provenance ?? []).map(item => item.source),
  ]);
  const warnings = uniqueStrings(opts.warnings ?? []);

  return {
    biocliVersion: getVersion(),
    data,
    ids,
    sources,
    warnings,
    queriedAt,
    organism: opts.organism,
    query: opts.query,
    completeness: deriveBiocliCompleteness(sources, warnings, opts.completeness),
    provenance: buildBiocliProvenance({
      queriedAt,
      ids,
      sources,
      provenance: opts.provenance,
    }),
  };
}

// ── Fetch options ─────────────────────────────────────────────────────────────

/** Options for a single HTTP request. Generic across all database backends. */
export interface FetchOptions {
  /** HTTP method (defaults to 'GET'). */
  method?: string;
  /** Additional HTTP headers. */
  headers?: Record<string, string>;
  /** URL query parameters (merged with any already in the URL). */
  params?: Record<string, string>;
  /** Request body (for POST requests). */
  body?: string;
  /** If true, skip the rate limiter for this request. */
  skipRateLimit?: boolean;
}

/**
 * @deprecated Use FetchOptions instead. Kept for backward compatibility
 * with existing NCBI adapters.
 */
export type NcbiFetchOptions = FetchOptions;

// ── HTTP context ──────────────────────────────────────────────────────────────

/**
 * HTTP execution context provided to every command function.
 *
 * Each database backend creates its own HttpContext with the appropriate
 * rate limiter, authentication, and response parsers baked in.
 */
export interface HttpContext {
  /** Database backend ID this context is bound to (e.g. 'ncbi', 'uniprot'). */
  databaseId: string;
  /** Make an HTTP request and return the raw Response. */
  fetch(url: string, opts?: FetchOptions): Promise<Response>;
  /** Fetch a URL and parse the response body as XML, returning the parsed object. */
  fetchXml(url: string, opts?: FetchOptions): Promise<unknown>;
  /** Fetch a URL and parse the response body as JSON. */
  fetchJson(url: string, opts?: FetchOptions): Promise<unknown>;
  /** Fetch a URL and return the raw text body. */
  fetchText(url: string, opts?: FetchOptions): Promise<string>;
  /** Database-specific credentials (NCBI: api_key, email; etc.). */
  credentials?: Record<string, string>;

  // ── NCBI backward-compat aliases ──
  /** @deprecated Use credentials?.api_key instead. */
  apiKey?: string;
  /** @deprecated Use credentials?.email instead. */
  email?: string;
}
