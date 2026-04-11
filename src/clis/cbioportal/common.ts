import type { HttpContext } from '../../types.js';
import {
  fetchMutationsForProfile,
  type CbioPortalMutation,
  type CbioPortalMutationFetchOptions,
} from '../../databases/cbioportal.js';

export function clampLimit(value: unknown, fallback = 500, max = 500): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(1, Math.min(Math.trunc(parsed), max));
}

export function summarizeCounts(
  items: string[],
  label: string,
  limit = 5,
): Array<Record<string, number | string>> {
  const counts = new Map<string, number>();
  for (const item of items) {
    const normalized = item.trim();
    if (!normalized) continue;
    counts.set(normalized, (counts.get(normalized) ?? 0) + 1);
  }

  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([value, count]) => ({ [label]: value, count }));
}

export async function fetchAllMutationPages(
  ctx: HttpContext,
  opts: CbioPortalMutationFetchOptions,
  maxPages = 200,
): Promise<CbioPortalMutation[]> {
  const pageSize = Math.max(1, Math.min(opts.pageSize ?? 500, 500));
  const mutations: CbioPortalMutation[] = [];

  for (let pageNumber = 0; pageNumber < maxPages; pageNumber++) {
    const page = await fetchMutationsForProfile(ctx, { ...opts, pageSize, pageNumber });
    if (page.length === 0) break;
    mutations.push(...page);
    if (page.length < pageSize) break;
  }

  return mutations;
}
