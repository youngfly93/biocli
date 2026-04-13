import { mapConcurrent } from './utils.js';

export interface BatchSuccess<T, I = string> {
  ok: true;
  item: I;
  index: number;
  attempts: number;
  result: T;
}

export interface BatchFailure<I = string> {
  ok: false;
  item: I;
  index: number;
  attempts: number;
  error: unknown;
}

export type BatchOutcome<T, I = string> = BatchSuccess<T, I> | BatchFailure<I>;

export interface BatchProgressSnapshot {
  total: number;
  completed: number;
  failed: number;
  inFlight: number;
  lastItem?: string;
}

export interface BatchRunOptions<T, I = string> {
  items: I[];
  concurrency: number;
  retries?: number;
  failFast?: boolean;
  maxErrors?: number;
  executor: (item: I, index: number, attempt: number) => Promise<T>;
  itemLabel?: (item: I) => string;
  onProgress?: (snapshot: BatchProgressSnapshot) => void;
  onSuccess?: (entry: BatchSuccess<T, I>) => void | Promise<void>;
  onFailure?: (entry: BatchFailure<I>) => void | Promise<void>;
}

export interface BatchRunResult<T, I = string> {
  outcomes: BatchOutcome<T, I>[];
  successes: BatchSuccess<T, I>[];
  failures: BatchFailure<I>[];
}

function itemLabel<T, I>(
  opts: BatchRunOptions<T, I>,
  item: I,
): string {
  return opts.itemLabel ? opts.itemLabel(item) : String(item);
}

function emitProgress<T, I>(
  opts: BatchRunOptions<T, I>,
  snapshot: BatchProgressSnapshot,
): void {
  opts.onProgress?.(snapshot);
}

export async function runBatch<T, I = string>(opts: BatchRunOptions<T, I>): Promise<BatchRunResult<T, I>> {
  if (opts.concurrency < 1) {
    throw new RangeError('Batch concurrency must be >= 1');
  }

  const outcomes: BatchOutcome<T, I>[] = new Array(opts.items.length);
  let completed = 0;
  let failed = 0;
  let inFlight = 0;
  let stopped = false;

  emitProgress(opts, {
    total: opts.items.length,
    completed,
    failed,
    inFlight,
  });

  await mapConcurrent(opts.items, async (item, index) => {
    if (stopped) return;

    inFlight += 1;
      emitProgress(opts, {
        total: opts.items.length,
        completed,
        failed,
        inFlight,
        lastItem: itemLabel(opts, item),
      });

    let attempt = 0;
    while (attempt <= (opts.retries ?? 0)) {
      attempt += 1;
      try {
        const result = await opts.executor(item, index, attempt);
        outcomes[index] = {
          ok: true,
          item,
          index,
          attempts: attempt,
          result,
        };
        await opts.onSuccess?.(outcomes[index] as BatchSuccess<T, I>);
        completed += 1;
        return;
      } catch (error) {
        if (attempt > (opts.retries ?? 0)) {
          outcomes[index] = {
            ok: false,
            item,
            index,
            attempts: attempt,
            error,
          };
          await opts.onFailure?.(outcomes[index] as BatchFailure<I>);
          completed += 1;
          failed += 1;
        }
      } finally {
        if (attempt > (opts.retries ?? 0) || outcomes[index]?.ok) {
          inFlight -= 1;
          emitProgress(opts, {
            total: opts.items.length,
            completed,
            failed,
            inFlight,
            lastItem: itemLabel(opts, item),
          });
        }
      }
    }

    if (opts.failFast || (opts.maxErrors != null && failed >= opts.maxErrors)) {
      stopped = true;
    }
  }, opts.concurrency).finally(() => {
    inFlight = 0;
    emitProgress(opts, {
      total: opts.items.length,
      completed,
      failed,
      inFlight,
    });
  });

  const normalized = outcomes.filter((outcome): outcome is BatchOutcome<T, I> => Boolean(outcome));
  return {
    outcomes: normalized,
    successes: normalized.filter((outcome): outcome is BatchSuccess<T, I> => outcome.ok),
    failures: normalized.filter((outcome): outcome is BatchFailure<I> => !outcome.ok),
  };
}
