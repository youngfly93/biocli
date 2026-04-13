import { CliError } from '../../errors.js';
import { runBatch } from '../../batch-runner.js';
import { createBatchArtifactSession, type BatchArtifactSession } from '../../batch-resume.js';
import { toBatchFailureRecord } from '../../batch-failures.js';
import { buildCacheKey, getCachedEntry, setCached } from '../../cache.js';
import { loadConfig } from '../../config.js';
import { reportProgress } from '../../progress.js';
import type {
  BatchCacheSummary,
  BatchFailureRecord,
  BatchSnapshotUsage,
  BatchSuccessRecord,
} from '../../batch-types.js';

export interface AggregateBatchOptions {
  concurrency?: number;
  outdir?: string;
  inputFile?: string;
  inputFormat?: string;
  key?: string;
  jsonl?: boolean;
  failFast?: boolean;
  maxErrors?: number;
  retries?: number;
  resume?: boolean;
  resumeFrom?: string;
  skipCached?: boolean;
  forceRefresh?: boolean;
  noCache?: boolean;
}

interface IndexedBatchItem {
  input: string;
  index: number;
}

export interface AggregateBatchPreparation {
  snapshots?: BatchSnapshotUsage[];
}

function aggregateBatchCachePolicy(batch: AggregateBatchOptions, cacheEnabled: boolean): BatchCacheSummary['policy'] {
  if (!cacheEnabled) return 'disabled';
  if (batch.forceRefresh) return 'force-refresh';
  if (batch.skipCached) return 'skip-cached';
  return 'default';
}

function buildAggregateBatchSuccess<T>(entry: {
  input: string;
  index: number;
  attempts: number;
  result: T;
  cache?: BatchSuccessRecord<T>['cache'];
}): BatchSuccessRecord<T> {
  return {
    input: entry.input,
    index: entry.index,
    attempts: entry.attempts,
    succeededAt: new Date().toISOString(),
    ...(entry.cache ? { cache: entry.cache } : {}),
    result: entry.result,
  };
}

export async function runAggregateBatch<T>(opts: {
  command: string;
  items: string[];
  batch: AggregateBatchOptions;
  progressLabel: string;
  executor: (item: string) => Promise<T>;
  cacheArgs?: (item: string) => Record<string, unknown>;
  prepareRun?: (ctx: { batch: AggregateBatchOptions; items: string[] }) => Promise<AggregateBatchPreparation | void>;
}): Promise<{
  results: T[];
  successes: BatchSuccessRecord<T>[];
  failures: BatchFailureRecord[];
  skippedCompleted: number;
}> {
  const shouldResume = opts.batch.resume === true || Boolean(opts.batch.resumeFrom);

  if (shouldResume && !opts.batch.outdir && !opts.batch.resumeFrom) {
    throw new CliError(
      'ARGUMENT',
      '--resume requires --outdir or --resume-from so completed items can be recovered from checkpoint files.',
    );
  }

  const batchStartedAt = new Date().toISOString();
  const indexedItems: IndexedBatchItem[] = opts.items.map((input, index) => ({ input, index }));
  const session: BatchArtifactSession<T> | null = (opts.batch.outdir || shouldResume)
    ? createBatchArtifactSession<T>({
        outdir: opts.batch.outdir,
        resume: shouldResume,
        resumeFrom: opts.batch.resumeFrom,
        command: opts.command,
      })
    : null;
  const pendingItems = session ? session.pendingEntries(indexedItems) : indexedItems;

  if (session && session.skippedCompletedCount > 0) {
    reportProgress(`Resume checkpoint: skipping ${session.skippedCompletedCount} completed item(s)…`);
  }

  const cacheConfig = loadConfig().cache;
  const cacheEnabled = (cacheConfig?.enabled ?? true) && opts.batch.noCache !== true && Boolean(opts.cacheArgs);
  const cacheTtlMs = (cacheConfig?.ttl ?? 24) * 60 * 60 * 1000;
  const cache: BatchCacheSummary = {
    policy: aggregateBatchCachePolicy(opts.batch, cacheEnabled),
    hits: 0,
    misses: 0,
    writes: 0,
  };

  const cachedSuccesses: BatchSuccessRecord<T>[] = [];
  const executionItems: IndexedBatchItem[] = [];

  if (cacheEnabled && opts.cacheArgs && !opts.batch.forceRefresh && opts.batch.skipCached) {
    for (const entry of pendingItems) {
      const cacheKey = buildCacheKey('aggregate', opts.command, opts.cacheArgs(entry.input));
      const cached = getCachedEntry<T>('aggregate', opts.command, cacheKey, cacheTtlMs);
      if (cached) {
        const record = buildAggregateBatchSuccess<T>({
          input: entry.input,
          index: entry.index,
          attempts: 0,
          cache: {
            hit: true,
            source: 'result-cache',
            cachedAt: new Date(cached.cachedAt).toISOString(),
          },
          result: cached.data,
        });
        cachedSuccesses.push(record);
        session?.recordSuccess(record);
        cache.hits += 1;
      } else {
        executionItems.push(entry);
        cache.misses += 1;
      }
    }
  } else {
    executionItems.push(...pendingItems);
    if (cacheEnabled) cache.misses = executionItems.length;
  }

  if (cachedSuccesses.length > 0) {
    reportProgress(`Batch cache: reusing ${cachedSuccesses.length} cached item(s)…`);
  }

  let snapshots: BatchSnapshotUsage[] | undefined;
  if (executionItems.length > 0 && opts.prepareRun) {
    const prepared = await opts.prepareRun({
      batch: opts.batch,
      items: executionItems.map(entry => entry.input),
    });
    snapshots = prepared?.snapshots;
  }

  const batchRun = await runBatch<T, IndexedBatchItem>({
    items: executionItems,
    concurrency: Math.max(1, Number(opts.batch.concurrency ?? 4)),
    retries: Math.max(0, Number(opts.batch.retries ?? 0)),
    failFast: opts.batch.failFast === true,
    maxErrors: opts.batch.maxErrors == null ? undefined : Math.max(1, Number(opts.batch.maxErrors)),
    itemLabel: (entry) => entry.input,
    onProgress: ({ completed, failed, inFlight, total, lastItem }) => {
      const totalDone = completed + cache.hits;
      const totalItems = opts.items.length;
      const suffix = lastItem ? ` ${lastItem}` : '';
      reportProgress(`${opts.progressLabel} ${totalDone}/${totalItems} done, ${failed} failed, ${inFlight} running…${suffix}`);
    },
    onSuccess: async (entry) => {
      const record = buildAggregateBatchSuccess<T>({
        input: entry.item.input,
        index: entry.item.index,
        attempts: entry.attempts,
        result: entry.result,
      });
      if (cacheEnabled && opts.cacheArgs) {
        const cacheKey = buildCacheKey('aggregate', opts.command, opts.cacheArgs(entry.item.input));
        try {
          setCached('aggregate', opts.command, cacheKey, entry.result, cacheTtlMs);
          cache.writes += 1;
        } catch {
          // Non-fatal: batch output should still succeed even if the shared cache directory is unavailable.
        }
      }
      if (!session) return;
      session.recordSuccess(record);
    },
    onFailure: async (entry) => {
      if (!session) return;
      session.recordFailure({
        ...toBatchFailureRecord(opts.command, entry, item => (item as IndexedBatchItem).input),
        index: entry.item.index,
      });
    },
    executor: async (entry) => opts.executor(entry.input),
  });

  const directSuccesses: BatchSuccessRecord<T>[] = [
    ...cachedSuccesses,
    ...batchRun.successes.map(entry => buildAggregateBatchSuccess<T>({
      input: entry.item.input,
      index: entry.item.index,
      attempts: entry.attempts,
      result: entry.result,
    })),
  ].sort((a, b) => a.index - b.index || a.input.localeCompare(b.input));
  const directFailures = batchRun.failures
    .map(entry => ({
      ...toBatchFailureRecord(opts.command, entry, item => (item as IndexedBatchItem).input),
      index: entry.item.index,
    }))
    .sort((a, b) => a.index - b.index || a.input.localeCompare(b.input));
  const batchFinishedAt = new Date().toISOString();

  const finalized = session
    ? session.finalize({
        command: opts.command,
        totalItems: opts.items.length,
        startedAt: batchStartedAt,
        finishedAt: batchFinishedAt,
        inputSource: opts.batch.inputFile ?? session.previousManifest?.inputSource ?? 'inline',
        inputFormat: opts.batch.inputFormat ?? session.previousManifest?.inputFormat,
        key: opts.batch.key ?? session.previousManifest?.key,
        concurrency: opts.batch.concurrency,
        retries: opts.batch.retries,
        failFast: opts.batch.failFast,
        maxErrors: opts.batch.maxErrors,
        cache: opts.cacheArgs ? cache : undefined,
        snapshots,
      })
    : {
        manifest: undefined,
        successes: directSuccesses,
        failures: directFailures,
      };

  if (finalized.successes.length === 0 && finalized.failures.length > 0) {
    throw new CliError(
      'EMPTY_RESULT',
      `All ${opts.items.length} batch items failed.`,
      finalized.failures
        .slice(0, 3)
        .map(entry => `${entry.input}: ${entry.message}`)
        .join(' | '),
    );
  }

  return {
    results: finalized.successes.map(entry => entry.result),
    successes: finalized.successes,
    failures: finalized.failures,
    skippedCompleted: session?.skippedCompletedCount ?? 0,
  };
}
