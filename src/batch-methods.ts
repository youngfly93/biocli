import { formatMethodsMarkdown } from './methods.js';
import type { BatchFailureRecord, BatchSuccessRecord } from './batch-types.js';
import { buildBiocliProvenance, type BiocliProvenanceSource } from './types.js';
import { isRecord } from './utils.js';

function uniqueByKey<T>(items: T[], keyFn: (item: T) => string): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const item of items) {
    const key = keyFn(item);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

function isProvenanceSource(value: unknown): value is BiocliProvenanceSource {
  return isRecord(value) && typeof value.source === 'string';
}

function collectSources(successes: BatchSuccessRecord[]): BiocliProvenanceSource[] {
  const inline = successes.flatMap((entry) => {
    const result = entry.result;
    if (!isRecord(result) || !isRecord(result.provenance)) return [];
    const sources = result.provenance.sources;
    return Array.isArray(sources) ? sources.filter(isProvenanceSource) : [];
  });

  if (inline.length > 0) {
    return uniqueByKey(inline, (source) => source.source);
  }

  const sourceNames = uniqueByKey(
    successes.flatMap((entry) => {
      const result = entry.result;
      if (!isRecord(result) || !Array.isArray(result.sources)) return [];
      return result.sources.filter((source): source is string => typeof source === 'string');
    }),
    (source) => source,
  );
  return buildBiocliProvenance({
    queriedAt: new Date().toISOString(),
    sources: sourceNames,
  }).sources;
}

function inferOrganism(successes: BatchSuccessRecord[]): string | undefined {
  for (const entry of successes) {
    const result = entry.result;
    if (isRecord(result) && typeof result.organism === 'string' && result.organism.trim()) {
      return result.organism;
    }
  }
  return undefined;
}

function inferVersion(successes: BatchSuccessRecord[]): string | undefined {
  for (const entry of successes) {
    const result = entry.result;
    if (isRecord(result) && typeof result.biocliVersion === 'string' && result.biocliVersion.trim()) {
      return result.biocliVersion;
    }
  }
  return undefined;
}

export function formatBatchMethodsMarkdown(opts: {
  command: string;
  inputCount: number;
  successes: BatchSuccessRecord[];
  failures: BatchFailureRecord[];
  startedAt: string;
  finishedAt: string;
}): string {
  const sourceSummary = collectSources(opts.successes);
  const completeness = opts.failures.length === 0
    ? 'complete'
    : opts.successes.length === 0
      ? 'degraded'
      : 'partial';
  const base = formatMethodsMarkdown({
    biocliVersion: inferVersion(opts.successes),
    query: `${opts.command} batch (${opts.inputCount} items)`,
    organism: inferOrganism(opts.successes),
    retrievedAt: opts.finishedAt,
    completeness,
    warningsCount: opts.successes.reduce((count, entry) => {
      const result = entry.result;
      if (!isRecord(result) || !Array.isArray(result.warnings)) return count;
      return count + result.warnings.length;
    }, 0),
    sources: sourceSummary,
  });

  const lines = [
    base,
    '',
    '## Batch Run',
    `- Command: \`${opts.command}\``,
    `- Started: ${opts.startedAt}`,
    `- Finished: ${opts.finishedAt}`,
    `- Inputs: ${opts.inputCount}`,
    `- Successes: ${opts.successes.length}`,
    `- Failures: ${opts.failures.length}`,
  ];

  if (opts.failures.length > 0) {
    lines.push('', '## Failure Summary');
    for (const failure of opts.failures.slice(0, 10)) {
      lines.push(`- ${failure.input}: ${failure.errorCode} — ${failure.message}`);
    }
  }

  return lines.join('\n');
}
