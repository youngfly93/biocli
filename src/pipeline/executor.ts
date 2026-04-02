/**
 * Pipeline executor: runs YAML pipeline steps sequentially.
 *
 * Adapted from opencli:
 * - No browser retry logic
 * - No browser window close on failure
 * - Sequential step execution with getStepHandler() from registry
 */

import { getStepHandler } from './registry.js';
import type { HttpContext } from '../types.js';

/**
 * Execute a pipeline (array of step objects) sequentially.
 *
 * Each step object has a single key (the step name) whose value is the params.
 * Data flows from one step to the next: the return value of step N becomes
 * the `data` argument for step N+1.
 *
 * @param pipeline - Array of step objects, e.g. [{ fetch: '...' }, { select: 'result.items' }]
 * @param ctx      - HttpContext for NCBI API access (may be null for pure transforms)
 * @param args     - User-provided arguments from the command invocation
 * @returns The final data value after all steps have executed
 */
export async function executePipeline(
  pipeline: Record<string, unknown>[],
  ctx: HttpContext | null,
  args: Record<string, unknown>,
): Promise<unknown> {
  let data: unknown = undefined;

  for (let i = 0; i < pipeline.length; i++) {
    const step = pipeline[i];
    if (!step || typeof step !== 'object') continue;

    const entries = Object.entries(step);
    if (entries.length === 0) continue;

    const [stepName, params] = entries[0];
    const handler = getStepHandler(stepName);
    if (!handler) {
      throw new Error(
        `Unknown pipeline step "${stepName}" at index ${i}. ` +
          `Known steps: ${(await import('./registry.js')).getKnownStepNames().join(', ')}`,
      );
    }

    data = await handler(ctx, params, data, args);
  }

  return data;
}
