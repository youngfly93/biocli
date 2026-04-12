import { AsyncLocalStorage } from 'node:async_hooks';

export type ProgressReporter = (message: string) => void;

export interface ProgressTask<T> {
  label: string;
  task: () => Promise<T>;
}

type ProgressTaskValue<TTask> = TTask extends ProgressTask<infer TResult> ? TResult : never;

const progressStorage = new AsyncLocalStorage<{ report?: ProgressReporter }>();

function summarizePending(labels: string[], limit = 3): string {
  if (labels.length <= limit) return labels.join(', ');
  const shown = labels.slice(0, limit).join(', ');
  return `${shown} (+${labels.length - limit} more)`;
}

function formatPendingMessage(prefix: string, labels: string[]): string {
  const normalizedPrefix = prefix.trim();
  const summary = summarizePending(labels);
  return summary ? `${normalizedPrefix} ${summary}…` : `${normalizedPrefix}…`;
}

export async function runWithProgressReporter<T>(
  report: ProgressReporter | undefined,
  fn: () => Promise<T>,
): Promise<T> {
  if (!report) return fn();
  return progressStorage.run({ report }, fn);
}

export function reportProgress(message: string): void {
  const normalized = message.trim();
  if (!normalized) return;
  progressStorage.getStore()?.report?.(normalized);
}

export async function allSettledWithProgress<const TTasks extends readonly ProgressTask<unknown>[]>(
  prefix: string,
  tasks: TTasks,
): Promise<{ [K in keyof TTasks]: PromiseSettledResult<Awaited<ProgressTaskValue<TTasks[K]>>> }> {
  const pending = new Set(tasks.map(task => task.label));

  const update = () => {
    if (pending.size === 0) return;
    reportProgress(formatPendingMessage(prefix, [...pending]));
  };

  update();

  const wrappedTasks = tasks.map(({ label, task }) => (async () => {
    try {
      return await task();
    } finally {
      pending.delete(label);
      update();
    }
  })());

  return Promise.allSettled(wrappedTasks) as Promise<{
    [K in keyof TTasks]: PromiseSettledResult<Awaited<ProgressTaskValue<TTasks[K]>>>
  }>;
}
