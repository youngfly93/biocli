import { describe, expect, it } from 'vitest';
import { allSettledWithProgress, reportProgress, runWithProgressReporter } from './progress.js';

describe('progress runtime', () => {
  it('reports only inside an active reporter context', async () => {
    const messages: string[] = [];

    reportProgress('outside');

    await runWithProgressReporter((message) => messages.push(message), async () => {
      reportProgress('inside');
    });

    expect(messages).toEqual(['inside']);
  });

  it('tracks pending tasks for allSettled flows', async () => {
    const messages: string[] = [];
    let releaseSlow = () => {};
    const slowTask = new Promise<string>((resolve) => {
      releaseSlow = () => resolve('slow');
    });

    const settledPromise = runWithProgressReporter((message) => messages.push(message), async () =>
      allSettledWithProgress('Waiting on', [
        { label: 'fast', task: async () => 'fast' },
        { label: 'slow', task: async () => slowTask },
      ]));

    await Promise.resolve();
    releaseSlow();

    const settled = await settledPromise;

    expect(settled).toEqual([
      { status: 'fulfilled', value: 'fast' },
      { status: 'fulfilled', value: 'slow' },
    ]);
    expect(messages).toEqual([
      'Waiting on fast, slow…',
      'Waiting on slow…',
    ]);
  });
});
