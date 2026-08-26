import { countDegraded, listDegradedInputs, summarizeBatchCompleteness } from './batch-completeness.js';
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

/**
 * Fields that identify a single record rather than the backend as a whole.
 * They are meaningless — and actively misleading — once merged across a batch,
 * because the first contributor of each backend would lend its accession
 * numbers to every other item.
 */
function mergeBatchSource(
  contributions: BiocliProvenanceSource[],
): BiocliProvenanceSource {
  const [first] = contributions;
  const consistent = <K extends keyof BiocliProvenanceSource>(key: K) => {
    const values = new Set(contributions.map(source => source[key]).filter(Boolean));
    return values.size === 1 ? first[key] : undefined;
  };

  // A contribution that names recordIds also has a record-scoped URL, which is
  // meaningless for the batch as a whole. Only URLs from contributions without
  // recordIds are backend roots, and only a consistent one survives the merge.
  const rootUrls = new Set(
    contributions
      .filter(source => !source.recordIds || source.recordIds.length === 0)
      .map(source => source.url)
      .filter((url): url is string => Boolean(url)),
  );
  const url = rootUrls.size === 1 ? [...rootUrls][0] : undefined;

  // recordIds are inherently per-item and are never carried to batch level;
  // per-item provenance stays in results.jsonl.
  return {
    source: first.source,
    ...(url ? { url } : {}),
    ...(consistent('apiVersion') ? { apiVersion: consistent('apiVersion') } : {}),
    ...(consistent('databaseRelease') ? { databaseRelease: consistent('databaseRelease') } : {}),
    ...(consistent('doi') ? { doi: consistent('doi') } : {}),
  };
}

function collectSources(successes: BatchSuccessRecord[]): BiocliProvenanceSource[] {
  const inline = successes.flatMap((entry) => {
    const result = entry.result;
    if (!isRecord(result) || !isRecord(result.provenance)) return [];
    const sources = result.provenance.sources;
    return Array.isArray(sources) ? sources.filter(isProvenanceSource) : [];
  });

  if (inline.length > 0) {
    const byBackend = new Map<string, BiocliProvenanceSource[]>();
    for (const source of inline) {
      const bucket = byBackend.get(source.source);
      if (bucket) bucket.push(source);
      else byBackend.set(source.source, [source]);
    }
    return [...byBackend.values()].map(mergeBatchSource);
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
  /**
   * Items left with no usable result. Defaults to the number of failure
   * records, but a --retry-degraded run can record a failed recovery attempt
   * for an item that still has data, so the summary count is passed in.
   */
  failedCount?: number;
}): string {
  const sourceSummary = collectSources(opts.successes);
  const breakdown = summarizeBatchCompleteness(opts.successes);
  const degradedInputs = listDegradedInputs(opts.successes);
  const degradedCount = breakdown ? countDegraded(breakdown) : 0;

  // A batch is only "complete" when nothing hard-failed AND every item that
  // reports completeness came back complete. Counting hard failures alone
  // let a run of partial results describe itself as complete.
  const completeness = opts.successes.length === 0
    ? 'degraded'
    : opts.failures.length > 0 || degradedCount > 0
      ? 'partial'
      : 'complete';
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
    `- Failures: ${opts.failedCount ?? opts.failures.length}`,
  ];

  if (breakdown) {
    lines.push(
      `- Complete: ${breakdown.complete}`,
      `- Incomplete: ${degradedCount} (${breakdown.partial} partial, ${breakdown.degraded} degraded)`,
    );
    if (degradedInputs.length > 0) {
      lines.push('', '## Incomplete Items', '', 'These inputs returned successfully but with incomplete data. Per-item sources and warnings are in `results.jsonl`; coverage per item is in the `completeness` column of `summary.csv`.', '');
      for (const input of degradedInputs.slice(0, 20)) lines.push(`- ${input}`);
      if (degradedInputs.length > 20) lines.push(`- …and ${degradedInputs.length - 20} more`);
    }
  }

  if (opts.failures.length > 0) {
    lines.push('', '## Failure Summary');
    for (const failure of opts.failures.slice(0, 10)) {
      lines.push(`- ${failure.input}: ${failure.errorCode} — ${failure.message}`);
    }
  }

  return lines.join('\n');
}
