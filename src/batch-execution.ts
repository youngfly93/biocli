import {
  countDegraded,
  listDegradedInputs,
  summarizeBatchCompleteness,
} from './batch-completeness.js';
import { runBatch, type BatchProgressSnapshot } from './batch-runner.js';
import { createBatchArtifactSession, type BatchArtifactSession } from './batch-resume.js';
import { toBatchFailureRecord } from './batch-failures.js';
import { buildCacheKey, getCachedEntry, setCached } from './cache.js';
import { ArgumentError, CliError, EXIT_CODES } from './errors.js';
import type {
  BatchCacheSummary,
  BatchFailureRecord,
  BatchManifest,
  BatchSnapshotUsage,
  BatchSuccessRecord,
} from './batch-types.js';

interface IndexedBatchItem {
  input: string;
  index: number;
}

export interface BatchExecutionPreparation {
  snapshots?: BatchSnapshotUsage[];
}

export interface BatchExecutionCacheOptions {
  namespace: string;
  command: string;
  enabled: boolean;
  ttlMs: number;
  read: boolean;
  policy: BatchCacheSummary['policy'];
  args: (item: string) => Record<string, unknown>;
}

export interface BatchExecutionProgress extends BatchProgressSnapshot {
  cached: number;
  totalItems: number;
}

export interface BatchExecutionOptions<T> {
  command: string;
  items: string[];
  concurrency?: number;
  retries?: number;
  failFast?: boolean;
  maxErrors?: number;
  /** Exit non-zero when any item succeeded with incomplete data. */
  strict?: boolean;
  outdir?: string;
  resume?: boolean;
  resumeFrom?: string;
  /** Resume, but also rerun checkpointed items that returned incomplete data. */
  retryDegraded?: boolean;
  inputSource?: string;
  inputFormat?: string;
  key?: string;
  cache?: BatchExecutionCacheOptions;
  executor: (item: string) => Promise<T>;
  prepareRun?: (ctx: { items: string[] }) => Promise<BatchExecutionPreparation | void>;
  onResume?: (skippedCompleted: number) => void;
  onCacheReuse?: (hits: number) => void;
  onProgress?: (progress: BatchExecutionProgress) => void;
}

export interface BatchExecutionResult<T> {
  results: T[];
  successes: BatchSuccessRecord<T>[];
  failures: BatchFailureRecord[];
  skippedCompleted: number;
  /** Inputs that succeeded but returned `partial` or `degraded` data. */
  degradedInputs: string[];
  cache?: BatchCacheSummary;
  manifest?: BatchManifest;
}

function buildBatchSuccess<T>(entry: {
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

function sortSuccesses<T>(records: BatchSuccessRecord<T>[]): BatchSuccessRecord<T>[] {
  return records.sort((a, b) => a.index - b.index || a.input.localeCompare(b.input));
}

function sortFailures(records: BatchFailureRecord[]): BatchFailureRecord[] {
  return records.sort((a, b) => a.index - b.index || a.input.localeCompare(b.input));
}

export async function runBatchExecution<T>(opts: BatchExecutionOptions<T>): Promise<BatchExecutionResult<T>> {
  const shouldResume = opts.resume === true || Boolean(opts.resumeFrom) || opts.retryDegraded === true;
  if (shouldResume && !opts.outdir && !opts.resumeFrom) {
    throw new ArgumentError(
      opts.retryDegraded === true
        ? '--retry-degraded requires --outdir or --resume-from so the previous run can be read from checkpoint files.'
        : '--resume requires --outdir or --resume-from so completed items can be recovered from checkpoint files.',
    );
  }

  const startedAt = new Date().toISOString();
  const indexedItems: IndexedBatchItem[] = opts.items.map((input, index) => ({ input, index }));
  const session: BatchArtifactSession<T> | null = (opts.outdir || shouldResume)
    ? createBatchArtifactSession<T>({
        outdir: opts.outdir,
        resume: shouldResume,
        resumeFrom: opts.resumeFrom,
        command: opts.command,
        retryDegraded: opts.retryDegraded,
      })
    : null;
  const pendingItems = session ? session.pendingEntries(indexedItems) : indexedItems;

  if (session && session.skippedCompletedCount > 0) {
    opts.onResume?.(session.skippedCompletedCount);
  }

  const cache = opts.cache
    ? {
        policy: opts.cache.policy,
        hits: 0,
        misses: 0,
        writes: 0,
      } satisfies BatchCacheSummary
    : undefined;
  const cachedSuccesses: BatchSuccessRecord<T>[] = [];
  const executionItems: IndexedBatchItem[] = [];

  // Retrying degraded items must never be satisfied from the cache that
  // produced them, so a retry pass always bypasses cache reads.
  if (opts.cache?.enabled && opts.cache.read && !opts.retryDegraded) {
    for (const entry of pendingItems) {
      const cacheKey = buildCacheKey(opts.cache.namespace, opts.cache.command, opts.cache.args(entry.input));
      const cached = getCachedEntry<T>(opts.cache.namespace, opts.cache.command, cacheKey, opts.cache.ttlMs);
      if (cached) {
        const record = buildBatchSuccess<T>({
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
        if (cache) cache.hits += 1;
      } else {
        executionItems.push(entry);
        if (cache) cache.misses += 1;
      }
    }
  } else {
    executionItems.push(...pendingItems);
    if (cache && opts.cache?.enabled) cache.misses = executionItems.length;
  }

  if (cachedSuccesses.length > 0) {
    opts.onCacheReuse?.(cachedSuccesses.length);
  }

  let snapshots: BatchSnapshotUsage[] | undefined;
  if (executionItems.length > 0 && opts.prepareRun) {
    const prepared = await opts.prepareRun({
      items: executionItems.map(entry => entry.input),
    });
    snapshots = prepared?.snapshots;
  }

  const batchRun = await runBatch<T, IndexedBatchItem>({
    items: executionItems,
    concurrency: Math.max(1, Number(opts.concurrency ?? 4)),
    retries: Math.max(0, Number(opts.retries ?? 0)),
    failFast: opts.failFast === true,
    maxErrors: opts.maxErrors == null ? undefined : Math.max(1, Number(opts.maxErrors)),
    itemLabel: entry => entry.input,
    onProgress: progress => opts.onProgress?.({
      ...progress,
      cached: cache?.hits ?? 0,
      totalItems: opts.items.length,
    }),
    onSuccess: async (entry) => {
      const record = buildBatchSuccess<T>({
        input: entry.item.input,
        index: entry.item.index,
        attempts: entry.attempts,
        result: entry.result,
      });
      if (opts.cache?.enabled) {
        const cacheKey = buildCacheKey(opts.cache.namespace, opts.cache.command, opts.cache.args(entry.item.input));
        try {
          setCached(opts.cache.namespace, opts.cache.command, cacheKey, entry.result, opts.cache.ttlMs);
          if (cache) cache.writes += 1;
        } catch {
          // Cache writes are advisory; artifact and stdout results remain authoritative.
        }
      }
      session?.recordSuccess(record);
    },
    onFailure: async (entry) => {
      if (!session) return;
      session.recordFailure({
        ...toBatchFailureRecord(opts.command, entry, item => (item as IndexedBatchItem).input),
        index: entry.item.index,
      });
    },
    executor: entry => opts.executor(entry.input),
  });

  const directSuccesses = sortSuccesses([
    ...cachedSuccesses,
    ...batchRun.successes.map(entry => buildBatchSuccess<T>({
      input: entry.item.input,
      index: entry.item.index,
      attempts: entry.attempts,
      result: entry.result,
    })),
  ]);
  const directFailures = sortFailures(batchRun.failures.map(entry => ({
    ...toBatchFailureRecord(opts.command, entry, item => (item as IndexedBatchItem).input),
    index: entry.item.index,
  })));
  const finishedAt = new Date().toISOString();

  const finalized = session
    ? session.finalize({
        command: opts.command,
        totalItems: opts.items.length,
        startedAt,
        finishedAt,
        inputSource: opts.inputSource ?? session.previousManifest?.inputSource ?? 'inline',
        inputFormat: opts.inputFormat ?? session.previousManifest?.inputFormat,
        key: opts.key ?? session.previousManifest?.key,
        concurrency: opts.concurrency,
        retries: opts.retries,
        failFast: opts.failFast,
        maxErrors: opts.maxErrors,
        cache,
        snapshots,
      })
    : {
        manifest: undefined,
        successes: directSuccesses,
        failures: directFailures,
      };

  // An item can succeed and still return incomplete data (an upstream 429, a
  // skipped cross-reference, an unresolvable identifier). Surface that here so
  // it can never be inferred away from `succeeded` alone.
  const degradedInputs = listDegradedInputs(finalized.successes);
  if (degradedInputs.length > 0) {
    const breakdown = summarizeBatchCompleteness(finalized.successes);
    const shown = degradedInputs.slice(0, 5).join(', ');
    const more = degradedInputs.length > 5 ? `, +${degradedInputs.length - 5} more` : '';
    const counts = breakdown
      ? ` (${breakdown.partial} partial, ${breakdown.degraded} degraded)`
      : '';
    process.stderr.write(
      `⚠ ${degradedInputs.length}/${opts.items.length} item(s) returned incomplete data${counts}: ${shown}${more}\n`
      + '  Inspect the completeness column in summary.csv, or rerun with --retry-degraded.\n',
    );
  }

  // --strict gates a delivery pipeline on coverage, so it has to account for
  // both ways coverage can be lost: an item that hard-failed, and an item that
  // succeeded with incomplete data. Checking only the latter let a run with
  // terminal failures pass the gate.
  if (opts.strict && (finalized.failures.length > 0 || degradedInputs.length > 0)) {
    const parts: string[] = [];
    if (finalized.failures.length > 0) parts.push(`${finalized.failures.length} failed`);
    if (degradedInputs.length > 0) parts.push(`${degradedInputs.length} returned incomplete data`);
    throw new CliError(
      'INCOMPLETE_DATA',
      `${parts.join(' and ')} out of ${opts.items.length} batch item(s).`,
      degradedInputs.length > 0
        ? 'Inspect failures.jsonl and summary.csv, rerun with --retry-degraded, or drop --strict to accept partial coverage.'
        : 'Inspect failures.jsonl, or drop --strict to accept partial coverage.',
      EXIT_CODES.INCOMPLETE_DATA,
    );
  }

  return {
    results: finalized.successes.map(entry => entry.result),
    successes: finalized.successes,
    failures: finalized.failures,
    skippedCompleted: session?.skippedCompletedCount ?? 0,
    degradedInputs,
    cache,
    manifest: finalized.manifest,
  };
}
