import { readFileSync } from 'node:fs';
import { ArgumentError, ConfigError } from './errors.js';
import {
  BIOCLI_COMPLETENESS_VALUES,
  buildBiocliProvenance,
  type BiocliCompleteness,
  type BiocliProvenance,
  type BiocliProvenanceSource,
} from './types.js';
import { isRecord } from './utils.js';

export const METHODS_FORMAT_VALUES = ['text', 'md', 'json'] as const;
export type MethodsFormat = typeof METHODS_FORMAT_VALUES[number];

export interface MethodsSummary {
  biocliVersion?: string;
  query?: string;
  organism?: string;
  retrievedAt: string;
  completeness: BiocliCompleteness;
  warningsCount: number;
  sources: BiocliProvenanceSource[];
}

function isMethodsFormat(value: string): value is MethodsFormat {
  return (METHODS_FORMAT_VALUES as readonly string[]).includes(value);
}

export function parseMethodsFormat(value: string): MethodsFormat {
  if (!isMethodsFormat(value)) {
    throw new ArgumentError(
      `Unknown methods format "${value}"`,
      `Use one of: ${METHODS_FORMAT_VALUES.join(', ')}`,
    );
  }
  return value;
}

function isCompletenessValue(value: unknown): value is BiocliCompleteness {
  return typeof value === 'string' && (BIOCLI_COMPLETENESS_VALUES as readonly string[]).includes(value);
}

function isBiocliProvenanceSource(value: unknown): value is BiocliProvenanceSource {
  return isRecord(value) && typeof value.source === 'string';
}

function isBiocliProvenance(value: unknown): value is BiocliProvenance {
  return isRecord(value)
    && typeof value.retrievedAt === 'string'
    && Array.isArray(value.sources)
    && value.sources.every(isBiocliProvenanceSource);
}

function readInput(pathname: string): string {
  try {
    if (pathname === '-') {
      return readFileSync(0, 'utf8');
    }
    return readFileSync(pathname, 'utf8');
  } catch (error) {
    throw new ArgumentError(
      `Failed to read methods input from ${pathname === '-' ? 'stdin' : pathname}`,
      error instanceof Error ? error.message : String(error),
    );
  }
}

export function loadMethodsInput(pathname: string): unknown {
  const raw = readInput(pathname);
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new ConfigError(
      `Methods input is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
      'Pass a JSON result file such as biocli output or a workflow manifest.json',
    );
  }
}

function getString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function getStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map(getString)
    .filter((item): item is string => Boolean(item));
}

function inferQuery(payload: Record<string, unknown>): string | undefined {
  return getString(payload.query)
    ?? getString(payload.dataset)
    ?? getString(payload.accession)
    ?? getString(payload.variant)
    ?? getString(payload.gene)
    ?? (() => {
      const genes = getStringArray(payload.genes);
      return genes.length > 0 ? genes.join(',') : undefined;
    })();
}

function inferOrganism(payload: Record<string, unknown>): string | undefined {
  return getString(payload.organism);
}

function inferWarningsCount(payload: Record<string, unknown>): number {
  return getStringArray(payload.warnings).length;
}

function inferIds(payload: Record<string, unknown>): Record<string, string> {
  const ids: Record<string, string> = {};

  if (isRecord(payload.ids)) {
    for (const [key, value] of Object.entries(payload.ids)) {
      const normalized = getString(value);
      if (normalized) ids[key] = normalized;
    }
  }

  const dataset = getString(payload.dataset);
  if (dataset && !ids.dataset) ids.dataset = dataset;

  const accession = getString(payload.accession);
  if (accession && /^PXD\d{6,7}$/i.test(accession) && !ids.pxd) {
    ids.pxd = accession;
  }

  const gene = getString(payload.gene);
  if (gene && !ids.gene) ids.gene = gene;

  const genes = getStringArray(payload.genes);
  if (!ids.gene && genes.length === 1) ids.gene = genes[0];

  const variant = getString(payload.variant);
  if (variant && /^rs\d+$/i.test(variant) && !ids.rsId) {
    ids.rsId = variant;
  }

  return ids;
}

function inferRetrievedAt(payload: Record<string, unknown>): string | undefined {
  if (isBiocliProvenance(payload.provenance)) return payload.provenance.retrievedAt;
  return getString(payload.queriedAt) ?? getString(payload.createdAt);
}

function inferSourceNames(payload: Record<string, unknown>): string[] {
  if (isBiocliProvenance(payload.provenance)) {
    return payload.provenance.sources.map(item => item.source);
  }
  return getStringArray(payload.sources);
}

function inferCompleteness(payload: Record<string, unknown>): BiocliCompleteness {
  if (isCompletenessValue(payload.completeness)) return payload.completeness;
  const sourceCount = inferSourceNames(payload).length;
  const warningsCount = inferWarningsCount(payload);
  if (sourceCount === 0) return 'degraded';
  if (warningsCount === 0) return 'complete';
  return 'partial';
}

export function summarizeMethodsInput(input: unknown): MethodsSummary {
  if (!isRecord(input)) {
    throw new ArgumentError(
      'Methods input must be a JSON object',
      'Pass a BiocliResult JSON or workflow manifest.json produced by biocli',
    );
  }

  const retrievedAt = inferRetrievedAt(input);
  if (!retrievedAt) {
    throw new ArgumentError(
      'Methods input is missing queriedAt/createdAt metadata',
      'Pass a BiocliResult JSON or workflow manifest.json produced by biocli',
    );
  }

  const provenance = isBiocliProvenance(input.provenance)
    ? input.provenance
    : (() => {
      const sources = inferSourceNames(input);
      if (sources.length === 0) {
        throw new ArgumentError(
          'Methods input is missing provenance and sources metadata',
          'Pass a BiocliResult JSON or workflow manifest.json produced by biocli',
        );
      }
      return buildBiocliProvenance({
        queriedAt: retrievedAt,
        ids: inferIds(input),
        sources,
      });
    })();

  return {
    biocliVersion: getString(input.biocliVersion),
    query: inferQuery(input),
    organism: inferOrganism(input),
    retrievedAt: provenance.retrievedAt,
    completeness: inferCompleteness(input),
    warningsCount: inferWarningsCount(input),
    sources: provenance.sources,
  };
}

function joinHuman(items: string[]): string {
  if (items.length === 0) return '';
  if (items.length === 1) return items[0];
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(', ')}, and ${items[items.length - 1]}`;
}

function describeSource(source: BiocliProvenanceSource): string {
  const details: string[] = [];
  if (source.recordIds && source.recordIds.length > 0) {
    details.push(source.recordIds.length === 1
      ? `record ${source.recordIds[0]}`
      : `records ${source.recordIds.join(', ')}`);
  }
  if (source.databaseRelease) details.push(`release ${source.databaseRelease}`);
  if (source.apiVersion) details.push(`API ${source.apiVersion}`);
  if (source.doi) details.push(`DOI ${source.doi}`);
  if (source.url) details.push(`URL ${source.url}`);
  return details.length > 0 ? `${source.source} (${details.join('; ')})` : source.source;
}

export function formatMethodsText(summary: MethodsSummary): string {
  const versionLabel = summary.biocliVersion ? `biocli v${summary.biocliVersion}` : 'biocli';
  const target = summary.query ? ` for query "${summary.query}"` : '';
  const organism = summary.organism ? ` in ${summary.organism}` : '';
  const sentences = [
    `${versionLabel} was used to retrieve structured biological data${target}${organism} on ${summary.retrievedAt}.`,
    `The resulting output was classified as ${summary.completeness}.`,
    `Integrated sources were ${joinHuman(summary.sources.map(describeSource))}.`,
  ];
  if (summary.warningsCount > 0) {
    sentences.push(`${summary.warningsCount} non-fatal warning(s) were recorded during result assembly.`);
  }
  return sentences.join(' ');
}

export function formatMethodsMarkdown(summary: MethodsSummary): string {
  const lines = [
    '## Methods Summary',
    '',
    formatMethodsText(summary),
    '',
    '## Sources',
    ...summary.sources.map(source => `- ${describeSource(source)}`),
  ];
  return lines.join('\n');
}

export function formatMethodsJson(summary: MethodsSummary): string {
  return JSON.stringify({
    ...summary,
    text: formatMethodsText(summary),
    markdown: formatMethodsMarkdown(summary),
  }, null, 2);
}

export function renderMethods(input: unknown, format: MethodsFormat): string {
  const summary = summarizeMethodsInput(input);
  switch (format) {
    case 'json':
      return formatMethodsJson(summary);
    case 'md':
      return formatMethodsMarkdown(summary);
    default:
      return formatMethodsText(summary);
  }
}
