import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { flattenBatchSuccesses } from './batch-flatteners.js';
import { formatBatchMethodsMarkdown } from './batch-methods.js';
import type { BatchSuccess } from './batch-runner.js';
import type {
  BatchCacheSummary,
  BatchFailureRecord,
  BatchManifest,
  BatchResumeMetadata,
  BatchRunSummary,
  BatchSnapshotUsage,
  BatchSuccessRecord,
} from './batch-types.js';
import { toCsv } from './csv.js';
import { getVersion } from './version.js';

export function toBatchSuccessRecord<T>(entry: BatchSuccess<T>): BatchSuccessRecord<T> {
  return {
    input: entry.item,
    index: entry.index,
    attempts: entry.attempts,
    succeededAt: new Date().toISOString(),
    result: entry.result,
  };
}

function toJsonl(rows: unknown[]): string {
  if (rows.length === 0) return '';
  return `${rows.map(row => JSON.stringify(row)).join('\n')}\n`;
}

export function writeBatchArtifacts<T>(opts: {
  outdir: string;
  command: string;
  summary: BatchRunSummary;
  inputSource?: string;
  inputFormat?: string;
  key?: string;
  concurrency?: number;
  retries?: number;
  failFast?: boolean;
  maxErrors?: number;
  resume?: BatchResumeMetadata;
  cache?: BatchCacheSummary;
  snapshots?: BatchSnapshotUsage[];
  successes: BatchSuccessRecord<T>[];
  failures: BatchFailureRecord[];
}): BatchManifest {
  mkdirSync(opts.outdir, { recursive: true });

  const files = {
    resultsJsonl: 'results.jsonl',
    failuresJsonl: 'failures.jsonl',
    summaryJson: 'summary.json',
    manifestJson: 'manifest.json',
  } as BatchManifest['files'];

  writeFileSync(join(opts.outdir, files.resultsJsonl), toJsonl(opts.successes));
  writeFileSync(join(opts.outdir, files.failuresJsonl), toJsonl(opts.failures));
  writeFileSync(join(opts.outdir, files.summaryJson), `${JSON.stringify(opts.summary, null, 2)}\n`);

  const flattened = flattenBatchSuccesses(opts.command, opts.successes);
  if (flattened) {
    files.summaryCsv = 'summary.csv';
    writeFileSync(join(opts.outdir, files.summaryCsv), toCsv(flattened.headers, flattened.rows));
  }

  files.methodsMd = 'methods.md';
  writeFileSync(join(opts.outdir, files.methodsMd), `${formatBatchMethodsMarkdown({
    command: opts.command,
    inputCount: opts.summary.totalItems,
    successes: opts.successes,
    failures: opts.failures,
    startedAt: opts.summary.startedAt,
    finishedAt: opts.summary.finishedAt,
  })}\n`);

  const manifest: BatchManifest = {
    ...opts.summary,
    biocliVersion: getVersion(),
    outdir: opts.outdir,
    inputSource: opts.inputSource,
    inputFormat: opts.inputFormat,
    key: opts.key,
    concurrency: opts.concurrency,
    retries: opts.retries,
    failFast: opts.failFast,
    maxErrors: opts.maxErrors,
    resume: opts.resume,
    cache: opts.cache,
    snapshots: opts.snapshots,
    files,
  };
  writeFileSync(join(opts.outdir, files.manifestJson), `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}
