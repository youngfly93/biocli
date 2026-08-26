import { CliError } from '../../errors.js';
import type { HttpContext } from '../../types.js';
import { buildEutilsUrl } from './eutils.js';

export interface GeoDatasetMetadata {
  source: 'GEO';
  database: 'gds';
  ncbiUid: string;
  accession: string;
  title: string;
  organism: string;
  type: string;
  platform: string;
  samples: number;
  summary: string;
  date: string;
}

export interface SraRunMetadata {
  source: 'SRA';
  database: 'sra';
  ncbiUid: string;
  accession: string;
  title: string;
  platform: string;
  organism: string;
  strategy: string;
  librarySource: string;
  layout: string;
  date: string;
}

export type DatasetMetadata = GeoDatasetMetadata | SraRunMetadata;

export interface FetchSraRunMetadataOptions {
  requireExactRun?: boolean;
}

function extractXmlTag(xml: string, tag: string): string {
  const match = xml.match(new RegExp(`<${tag}[^>]*>([^<]*)</${tag}>`));
  return match ? match[1].trim() : '';
}

function extractXmlAttr(xml: string, tag: string, attr: string): string {
  const match = xml.match(new RegExp(`<${tag}[^>]*${attr}="([^"]*)"[^>]*>`));
  return match ? match[1].trim() : '';
}

function getSearchIds(payload: unknown): string[] {
  const result = payload as Record<string, unknown>;
  const search = result?.esearchresult as Record<string, unknown> | undefined;
  return (search?.idlist as string[] | undefined) ?? [];
}

function getSummaryItem(payload: unknown, uid: string): Record<string, unknown> {
  const summary = payload as Record<string, unknown>;
  const result = summary?.result as Record<string, unknown> | undefined;
  return (result?.[uid] ?? {}) as Record<string, unknown>;
}

export async function fetchGeoDatasetMetadata(
  ctx: HttpContext,
  accession: string,
): Promise<GeoDatasetMetadata> {
  const normalized = accession.trim().toUpperCase();
  const searchResult = await ctx.fetchJson(buildEutilsUrl('esearch.fcgi', {
    db: 'gds',
    term: `${normalized}[Accession]`,
    retmode: 'json',
  }));
  const ids = getSearchIds(searchResult);
  if (!ids.length) {
    throw new CliError('NOT_FOUND', `GEO entry ${normalized} not found`, 'Check the accession or use `biocli geo search <query> -f json`.');
  }

  const uid = ids[0];
  const summaryResult = await ctx.fetchJson(buildEutilsUrl('esummary.fcgi', {
    db: 'gds',
    id: uid,
    retmode: 'json',
  }));
  const item = getSummaryItem(summaryResult, uid);
  const resolvedAccession = String(item.accession ?? '').toUpperCase();
  if (resolvedAccession !== normalized) {
    throw new CliError('NOT_FOUND', `GEO entry ${normalized} did not resolve to an exact accession`, 'Check the accession or use `biocli geo search <query> -f json`.');
  }

  return {
    source: 'GEO',
    database: 'gds',
    ncbiUid: uid,
    accession: resolvedAccession,
    title: String(item.title ?? ''),
    organism: String(item.taxon ?? ''),
    type: String(item.entrytype ?? ''),
    platform: String(item.gpl ?? ''),
    samples: Number(item.n_samples ?? 0),
    summary: String(item.summary ?? ''),
    date: String(item.pdat ?? ''),
  };
}

export async function fetchSraRunMetadata(
  ctx: HttpContext,
  accession: string,
  opts: FetchSraRunMetadataOptions = {},
): Promise<SraRunMetadata> {
  const normalized = accession.trim().toUpperCase();
  const searchResult = await ctx.fetchJson(buildEutilsUrl('esearch.fcgi', {
    db: 'sra',
    term: `${normalized}[Accession]`,
    retmode: 'json',
  }));
  const ids = getSearchIds(searchResult);
  if (!ids.length) {
    throw new CliError('NOT_FOUND', `SRA entry ${normalized} not found`, 'Check the accession or use `biocli sra search <query> -f json`.');
  }

  const uid = ids[0];
  const summaryResult = await ctx.fetchJson(buildEutilsUrl('esummary.fcgi', {
    db: 'sra',
    id: uid,
    retmode: 'json',
  }));
  const item = getSummaryItem(summaryResult, uid);
  const expXml = String(item.expxml ?? '');
  const runsXml = String(item.runs ?? '');
  const resolvedAccession = extractXmlAttr(runsXml, 'Run', 'acc').toUpperCase() || normalized;
  if (opts.requireExactRun && resolvedAccession !== normalized) {
    throw new CliError('NOT_FOUND', `SRA entry ${normalized} did not resolve to an exact run accession`, 'Check the accession or use `biocli sra search <query> -f json`.');
  }

  let layout = '';
  if (expXml.includes('PAIRED')) layout = 'PAIRED';
  else if (expXml.includes('SINGLE')) layout = 'SINGLE';

  return {
    source: 'SRA',
    database: 'sra',
    ncbiUid: uid,
    accession: resolvedAccession,
    title: extractXmlTag(expXml, 'Title'),
    platform: extractXmlAttr(expXml, 'Platform', 'instrument_model')
      || extractXmlTag(expXml, 'Platform'),
    organism: extractXmlAttr(expXml, 'Organism', 'taxname')
      || extractXmlTag(expXml, 'Organism'),
    strategy: extractXmlTag(expXml, 'Library_strategy')
      || extractXmlAttr(expXml, 'Library_descriptor', 'LIBRARY_STRATEGY'),
    librarySource: extractXmlTag(expXml, 'Library_source'),
    layout,
    date: String(item.createdate ?? ''),
  };
}
