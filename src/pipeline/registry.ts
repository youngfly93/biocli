/**
 * Dynamic registry for pipeline steps.
 *
 * Only data pipeline steps are registered (no browser steps).
 * Allows core and third-party plugins to register custom YAML operations.
 */

import { handleFetch } from './steps/fetch.js';
import {
  handleSelect,
  handleMap,
  handleFilter,
  handleSort,
  handleLimit,
} from './steps/transform.js';
import { handleXmlParse } from './steps/xml-parse.js';
import type { HttpContext } from '../types.js';

export type StepHandler = (
  ctx: HttpContext | null,
  params: unknown,
  data: unknown,
  args: Record<string, unknown>,
) => Promise<unknown>;

const stepRegistry = new Map<string, StepHandler>();

// ── Register core steps ─────────────────────────────────────────────────────

stepRegistry.set('fetch', handleFetch);
stepRegistry.set('select', handleSelect);
stepRegistry.set('map', handleMap);
stepRegistry.set('filter', handleFilter);
stepRegistry.set('sort', handleSort);
stepRegistry.set('limit', handleLimit);
stepRegistry.set('xml-parse', handleXmlParse);

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Get a registered step handler by name.
 */
export function getStepHandler(name: string): StepHandler | undefined {
  return stepRegistry.get(name);
}

/**
 * List all registered step names (useful for validation / help output).
 */
export function getKnownStepNames(): string[] {
  return [...stepRegistry.keys()];
}
