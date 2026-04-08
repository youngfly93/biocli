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
 * Canonicalize a Unimod site name.
 *
 *   • Single amino acid letters → uppercase ("s" → "S")
 *   • "N-term" / "C-term" recognized case-insensitively, normalized to the
 *     exact spelling Unimod uses ("N-term" / "C-term")
 *   • Anything else preserved as-is (so unusual sites still pass through)
 *
 * Used by every command that takes a residue/site argument so users can
 * type any case variant (`N-term`, `n-term`, `N-TERM`) and still get a
 * match against the dataset's canonical form.
 */
export function canonicalizeSite(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return trimmed;
  if (trimmed.length === 1) return trimmed.toUpperCase();
  const lower = trimmed.toLowerCase();
  if (lower === 'n-term') return 'N-term';
  if (lower === 'c-term') return 'C-term';
  return trimmed;
}

/**
 * Split a CLI-supplied comma-separated filter into a canonical set.
 * Returns `null` if the input is empty (no filter → match anything).
 *
 * `caseMode`:
 *   - 'lower' — lowercase for case-insensitive matching (classifications, positions)
 *   - 'upper' — uppercase for plain string filters
 *   - 'exact' — leave as-is
 *   - 'site'  — canonicalize as a Unimod site (single AAs uppercased,
 *               N-term/C-term normalized regardless of input case)
 */
export function parseCsvFilter(
  raw: unknown,
  caseMode: 'lower' | 'upper' | 'exact' | 'site' = 'lower',
): Set<string> | null {
  if (raw === undefined || raw === null || raw === '') return null;
  const str = String(raw);
  const parts = str.split(',').map(s => s.trim()).filter(Boolean);
  if (parts.length === 0) return null;
  const transformed = parts.map(p => {
    if (caseMode === 'lower') return p.toLowerCase();
    if (caseMode === 'upper') return p.toUpperCase();
    if (caseMode === 'site') return canonicalizeSite(p);
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
    // Canonicalize the spec's site the same way we canonicalize user input
    // so case variants of N-term/C-term match correctly.
    const canonical = canonicalizeSite(spec.site ?? '');
    if (!filter.residues.has(canonical)) return false;
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
