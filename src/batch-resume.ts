import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { writeBatchArtifacts } from './batch-output.js';
import type {
  BatchCacheSummary,
  BatchFailureRecord,
  BatchManifest,
  BatchSnapshotUsage,
  BatchSuccessRecord,
} from './batch-types.js';

function readJsonl<T>(pathname: string): T[] {
  if (!existsSync(pathname)) return [];
  const raw = readFileSync(pathname, 'utf-8');
  return raw
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => JSON.parse(line) as T);
}

function appendJsonl(pathname: string, row: unknown): void {
  appendFileSync(pathname, `${JSON.stringify(row)}\n`);
}

function sortByIndex<T extends { index: number; input: string }>(items: T[]): T[] {
  return [...items].sort((a, b) => a.index - b.index || a.input.localeCompare(b.input));
}

function checkpointKey(index: number, input: string): string {
  return `${index}:${input}`;
}

export interface BatchArtifactSession<T = unknown> {
  readonly outdir: string;
  readonly resumeSource?: string;
  readonly previousManifest?: BatchManifest;
  readonly previousSuccesses: BatchSuccessRecord<T>[];
  readonly previousFailures: BatchFailureRecord[];
  readonly skippedCompletedCount: number;
  pendingEntries(items: Array<{ input: string; index: number }>): Array<{ input: string; index: number }>;
  pendingItems(items: string[]): string[];
  recordSuccess(record: BatchSuccessRecord<T>): void;
  recordFailure(record: BatchFailureRecord): void;
  finalize(opts: {
    command: string;
    totalItems: number;
    startedAt: string;
    finishedAt: string;
    inputSource?: string;
    inputFormat?: string;
    key?: string;
    concurrency?: number;
    retries?: number;
    failFast?: boolean;
    maxErrors?: number;
    cache?: BatchCacheSummary;
    snapshots?: BatchSnapshotUsage[];
  }): {
    manifest: BatchManifest;
    successes: BatchSuccessRecord<T>[];
    failures: BatchFailureRecord[];
  };
}

function resolveResumeTarget(outdir: string | undefined, resumeFrom: string | undefined): {
  outdir: string;
  resumeSource?: string;
  previousManifest?: BatchManifest;
} {
  if (!resumeFrom) {
    if (!outdir) throw new Error('Batch artifact session requires --outdir or --resume-from');
    return { outdir };
  }

  const normalizedResumeFrom = resolve(resumeFrom);
  const resumeOutdir = normalizedResumeFrom.endsWith('.json')
    ? dirname(normalizedResumeFrom)
    : normalizedResumeFrom;

  if (outdir && resolve(outdir) !== resumeOutdir) {
    throw new Error(`--outdir (${outdir}) does not match --resume-from (${resumeFrom})`);
  }

  const manifestPath = normalizedResumeFrom.endsWith('.json')
    ? normalizedResumeFrom
    : join(resumeOutdir, 'manifest.json');
  const previousManifest = existsSync(manifestPath)
    ? JSON.parse(readFileSync(manifestPath, 'utf-8')) as BatchManifest
    : undefined;

  return {
    outdir: resumeOutdir,
    resumeSource: normalizedResumeFrom,
    previousManifest,
  };
}

export function createBatchArtifactSession<T = unknown>(opts: {
  outdir?: string;
  resume?: boolean;
  resumeFrom?: string;
  command?: string;
}): BatchArtifactSession<T> {
  const resolved = resolveResumeTarget(opts.outdir, opts.resumeFrom);
  if (resolved.previousManifest && opts.command && resolved.previousManifest.command !== opts.command) {
    throw new Error(
      `Resume manifest command mismatch: expected "${opts.command}" but found "${resolved.previousManifest.command}"`,
    );
  }

  mkdirSync(resolved.outdir, { recursive: true });

  const resultsPath = join(resolved.outdir, 'results.jsonl');
  const failuresPath = join(resolved.outdir, 'failures.jsonl');
  const previousSuccesses = opts.resume ? readJsonl<BatchSuccessRecord<T>>(resultsPath) : [];
  const previousFailures = opts.resume ? readJsonl<BatchFailureRecord>(failuresPath) : [];
  const completedKeys = new Set(previousSuccesses.map(entry => checkpointKey(entry.index, entry.input)));
  const newSuccesses: BatchSuccessRecord<T>[] = [];
  const newFailures: BatchFailureRecord[] = [];

  if (!opts.resume) {
    writeFileSync(resultsPath, '');
    writeFileSync(failuresPath, '');
  }

  return {
    outdir: resolved.outdir,
    resumeSource: resolved.resumeSource,
    previousManifest: resolved.previousManifest,
    previousSuccesses,
    previousFailures,
    skippedCompletedCount: previousSuccesses.length,
    pendingEntries(items) {
      return items.filter(entry => !completedKeys.has(checkpointKey(entry.index, entry.input)));
    },
    pendingItems(items: string[]) {
      return items
        .map((input, index) => ({ input, index }))
        .filter(entry => !completedKeys.has(checkpointKey(entry.index, entry.input)))
        .map(entry => entry.input);
    },
    recordSuccess(record) {
      newSuccesses.push(record);
      appendJsonl(resultsPath, record);
    },
    recordFailure(record) {
      newFailures.push(record);
      appendJsonl(failuresPath, record);
    },
    finalize(finalizeOpts) {
      const successByKey = new Map<string, BatchSuccessRecord<T>>();
      for (const record of previousSuccesses) successByKey.set(checkpointKey(record.index, record.input), record);
      for (const record of newSuccesses) successByKey.set(checkpointKey(record.index, record.input), record);
      const mergedSuccesses = sortByIndex([...successByKey.values()]);
      const successfulKeys = new Set(mergedSuccesses.map(record => checkpointKey(record.index, record.input)));

      const failureByKey = new Map<string, BatchFailureRecord>();
      for (const record of previousFailures) {
        const key = checkpointKey(record.index, record.input);
        if (!successfulKeys.has(key)) failureByKey.set(key, record);
      }
      for (const record of newFailures) {
        const key = checkpointKey(record.index, record.input);
        if (!successfulKeys.has(key)) failureByKey.set(key, record);
      }
      const mergedFailures = sortByIndex([...failureByKey.values()]);

      const manifest = writeBatchArtifacts({
        outdir: resolved.outdir,
        command: finalizeOpts.command,
        summary: {
          command: finalizeOpts.command,
          totalItems: finalizeOpts.totalItems,
          succeeded: mergedSuccesses.length,
          failed: mergedFailures.length,
          startedAt: finalizeOpts.startedAt,
          finishedAt: finalizeOpts.finishedAt,
          durationSeconds: Number((((Date.parse(finalizeOpts.finishedAt) - Date.parse(finalizeOpts.startedAt)) / 1000)).toFixed(3)),
        },
        inputSource: finalizeOpts.inputSource,
        inputFormat: finalizeOpts.inputFormat,
        key: finalizeOpts.key,
        concurrency: finalizeOpts.concurrency,
        retries: finalizeOpts.retries,
        failFast: finalizeOpts.failFast,
        maxErrors: finalizeOpts.maxErrors,
        cache: finalizeOpts.cache,
        snapshots: finalizeOpts.snapshots,
        resume: opts.resume
          ? {
              resumed: true,
              source: resolved.resumeSource ?? resolved.outdir,
              skippedCompleted: previousSuccesses.length,
              previousSucceeded: resolved.previousManifest?.succeeded ?? previousSuccesses.length,
              previousFailed: resolved.previousManifest?.failed ?? previousFailures.length,
            }
          : undefined,
        successes: mergedSuccesses,
        failures: mergedFailures,
      });

      return {
        manifest,
        successes: mergedSuccesses,
        failures: mergedFailures,
      };
    },
  };
}
