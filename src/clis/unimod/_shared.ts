/**
 * Shared helpers for unimod CLI commands.
 *
 * Filter parsing, row flattening, attribution helpers. Internal —
 * not part of the public API.
 */

import chalk from 'chalk';
import type { UnimodMod, UnimodSpecificity } from '../../datasets/unimod.js';
import { UNIMOD_ATTRIBUTION } from '../../datasets/unimod.js';

/**
 * Split a CLI-supplied comma-separated filter into a canonical set.
 * Returns `null` if the input is empty (no filter → match anything).
 *
 * `caseMode`:
 *   - 'lower' — lowercase for case-insensitive matching (classifications)
 *   - 'upper' — uppercase for residue single-letters
 *   - 'exact' — leave as-is (for multi-word site values like "N-term")
 */
export function parseCsvFilter(
  raw: unknown,
  caseMode: 'lower' | 'upper' | 'exact' = 'lower',
): Set<string> | null {
  if (raw === undefined || raw === null || raw === '') return null;
  const str = String(raw);
  const parts = str.split(',').map(s => s.trim()).filter(Boolean);
  if (parts.length === 0) return null;
  const transformed = parts.map(p => {
    if (caseMode === 'lower') return p.toLowerCase();
    if (caseMode === 'upper') return p.toUpperCase();
    return p;
  });
  return new Set(transformed);
}

/**
 * Test whether a specificity passes a set of filters.
 *
 * Each filter is either `null` (accept anything) or a Set of acceptable
 * values. Filters are applied case-insensitively to match `parseCsvFilter`.
 */
export interface SpecificityFilter {
  residues: Set<string> | null;      // uppercase single letters or "N-term"/"C-term"
  positions: Set<string> | null;     // case-insensitive
  classifications: Set<string> | null; // case-insensitive
  includeHidden: boolean;
}

export function specificityMatches(spec: UnimodSpecificity, filter: SpecificityFilter): boolean {
  if (!filter.includeHidden && spec.hidden) return false;
  if (filter.residues) {
    // Site values are either single AA letters (uppercase) or "N-term"/"C-term".
    // We normalize by uppercasing single letters only. For multi-char sites we
    // do an exact-match fallback.
    const site = spec.site ?? '';
    const siteUpper = site.length === 1 ? site.toUpperCase() : site;
    if (!filter.residues.has(siteUpper) && !filter.residues.has(site)) return false;
  }
  if (filter.positions) {
    if (!filter.positions.has((spec.position ?? '').toLowerCase())) return false;
  }
  if (filter.classifications) {
    if (!filter.classifications.has((spec.classification ?? '').toLowerCase())) return false;
  }
  return true;
}

/**
 * Collect specificities on a mod that pass the filter. Returns an empty
 * array if the mod has no matching specificity.
 */
export function matchingSpecificities(
  mod: UnimodMod,
  filter: SpecificityFilter,
): UnimodSpecificity[] {
  return mod.specificities.filter(s => specificityMatches(s, filter));
}

/** Join a set into a display string, handling `null` as "(any)". */
export function joinSet(s: Set<string> | null): string {
  return s === null ? '' : [...s].join(',');
}

/** Emit the Unimod attribution line to stderr. Always called at end of a command. */
export function emitAttribution(): void {
  console.error(chalk.dim(UNIMOD_ATTRIBUTION));
}

/**
 * Collapse distinct values of a field across a specificity list to a
 * comma-separated display string (used for list/search row rendering).
 */
export function joinDistinct<T extends UnimodSpecificity, K extends keyof T>(
  specs: T[],
  field: K,
): string {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const s of specs) {
    const val = s[field];
    if (val === undefined || val === null || val === '') continue;
    const str = String(val);
    if (seen.has(str)) continue;
    seen.add(str);
    out.push(str);
  }
  return out.join(', ');
}
