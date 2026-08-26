import { runBatchExecution, type BatchExecutionPreparation } from '../../batch-execution.js';
import { CliError } from '../../errors.js';
import { loadConfig } from '../../config.js';
import { reportProgress } from '../../progress.js';
import type {
  BatchCacheSummary,
  BatchFailureRecord,
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
  /** Resume, but also rerun checkpointed items that returned incomplete data. */
  retryDegraded?: boolean;
  /** Exit non-zero when any item returns incomplete data. */
  strict?: boolean;
  skipCached?: boolean;
  forceRefresh?: boolean;
  noCache?: boolean;
}

export interface AggregateBatchPreparation extends BatchExecutionPreparation {}

function aggregateBatchCachePolicy(
  batch: AggregateBatchOptions,
  cacheEnabled: boolean,
): BatchCacheSummary['policy'] {
  if (!cacheEnabled) return 'disabled';
  if (batch.forceRefresh) return 'force-refresh';
  if (batch.skipCached) return 'skip-cached';
  return 'default';
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
  const cacheConfig = loadConfig().cache;
  const cacheEnabled = (cacheConfig?.enabled ?? true) && opts.batch.noCache !== true && Boolean(opts.cacheArgs);
  const cacheTtlMs = (cacheConfig?.ttl ?? 24) * 60 * 60 * 1000;

  const result = await runBatchExecution<T>({
    command: opts.command,
    items: opts.items,
    concurrency: opts.batch.concurrency,
    retries: opts.batch.retries,
    failFast: opts.batch.failFast,
    maxErrors: opts.batch.maxErrors,
    outdir: opts.batch.outdir,
    resume: opts.batch.resume,
    resumeFrom: opts.batch.resumeFrom,
    retryDegraded: opts.batch.retryDegraded,
    strict: opts.batch.strict,
    inputSource: opts.batch.inputFile,
    inputFormat: opts.batch.inputFormat,
    key: opts.batch.key,
    cache: opts.cacheArgs
      ? {
          namespace: 'aggregate',
          command: opts.command,
          enabled: cacheEnabled,
          ttlMs: cacheTtlMs,
          read: cacheEnabled && opts.batch.forceRefresh !== true && opts.batch.skipCached === true,
          policy: aggregateBatchCachePolicy(opts.batch, cacheEnabled),
          args: opts.cacheArgs,
        }
      : undefined,
    prepareRun: opts.prepareRun
      ? ({ items }) => opts.prepareRun!({ batch: opts.batch, items })
      : undefined,
    executor: opts.executor,
    onResume: skipped => {
      reportProgress(`Resume checkpoint: skipping ${skipped} completed item(s)…`);
    },
    onCacheReuse: hits => {
      reportProgress(`Batch cache: reusing ${hits} cached item(s)…`);
    },
    onProgress: ({ completed, failed, inFlight, lastItem, cached, totalItems }) => {
      const suffix = lastItem ? ` ${lastItem}` : '';
      reportProgress(`${opts.progressLabel} ${completed + cached}/${totalItems} done, ${failed} failed, ${inFlight} running…${suffix}`);
    },
  });

  if (result.successes.length === 0 && result.failures.length > 0) {
    throw new CliError(
      'EMPTY_RESULT',
      `All ${opts.items.length} batch items failed.`,
      result.failures
        .slice(0, 3)
        .map(entry => `${entry.input}: ${entry.message}`)
        .join(' | '),
    );
  }

  return {
    results: result.results,
    successes: result.successes,
    failures: result.failures,
    skippedCompleted: result.skippedCompleted,
  };
}
