/**
 * biocli unimod by-mass — Look up modifications matching a mass shift.
 *
 * The headline feature for open-search proteomics workflows: given a delta
 * mass (from MSFragger / pFind / FragPipe open search), return all Unimod
 * entries that could explain it, filtered by residue, position, and
 * classification.
 *
 * ## Output shape (critical — read before modifying)
 *
 * One row per `(UnimodMod, matching Specificity)` tuple. Every row carries
 * the query parameters (`queryMass`, `queryTolerance`, `queryToleranceUnit`)
 * and a per-query `rank`. This is mandatory because biocli's batch merge
 * (`src/batch.ts:mergeBatchResults`) flattens arrays across multiple
 * `--input` lines into a single output, and without per-row correlation
 * fields users cannot reconstruct which candidate belongs to which input.
 *
 * Sorted by |deltaFromQuery| ascending, then site, then classification.
 *
 * Data: Unimod (https://www.unimod.org), Design Science License.
 */

import { cli } from '../../registry.js';
import { withMeta } from '../../types.js';
import { ArgumentError } from '../../errors.js';
import { loadUnimod, type UnimodMod, type UnimodSpecificity } from '../../datasets/unimod.js';
import {
  parseCsvFilter,
  specificityMatches,
  emitAttribution,
  type SpecificityFilter,
} from './_shared.js';

interface ByMassRow {
  // Query correlation (present on EVERY row)
  queryMass: number;
  queryTolerance: number;
  queryToleranceUnit: 'Da' | 'ppm';
  rank: number;
  // Mod + specificity fields
  accession: string;
  title: string;
  fullName: string;
  monoMass: number;
  avgMass: number;
  composition: string;
  site: string;
  position: string;
  classification: string;
  hidden: boolean;
  neutralLossMono: number | null;
  neutralLossComposition: string | null;
  // Delta (signed: massField - queryMass)
  deltaFromQuery: number;
}

function flattenMatches(
  mod: UnimodMod,
  matching: UnimodSpecificity[],
  queryMass: number,
  queryTolerance: number,
  queryToleranceUnit: 'Da' | 'ppm',
  massField: 'monoMass' | 'avgMass',
): ByMassRow[] {
  const delta = mod[massField] - queryMass;
  return matching.map(spec => ({
    queryMass,
    queryTolerance,
    queryToleranceUnit,
    rank: 0, // assigned after global sort
    accession: mod.accession,
    title: mod.title,
    fullName: mod.fullName,
    monoMass: mod.monoMass,
    avgMass: mod.avgMass,
    composition: mod.composition,
    site: spec.site,
    position: spec.position,
    classification: spec.classification,
    hidden: spec.hidden,
    neutralLossMono: spec.neutralLossMono ?? null,
    neutralLossComposition: spec.neutralLossComposition ?? null,
    deltaFromQuery: delta,
  }));
}

cli({
  site: 'unimod',
  name: 'by-mass',
  database: 'unimod',
  noContext: true,
  description:
    'Find Unimod modifications matching a mass shift (killer feature for open-search PTM annotation). ' +
    'Data: Unimod (https://www.unimod.org), Design Science License.',
  args: [
    { name: 'mass', type: 'number', positional: true, required: true, help: 'Observed mass shift in Da (e.g. 79.9663). Negative values accepted for losses, e.g. -18.0106 for water loss.' },
    { name: 'tolerance', type: 'number', default: 0.01, help: 'Tolerance window (Da or ppm depending on --tolerance-unit)' },
    { name: 'tolerance-unit', default: 'Da', choices: ['Da', 'ppm'], help: 'Tolerance unit — Da or ppm' },
    { name: 'residue', help: 'Filter by amino acid (e.g. S,T,Y) or N-term/C-term' },
    { name: 'position', help: 'Filter by position (Anywhere, Any N-term, Protein N-term, …)' },
    { name: 'classification', help: 'Filter by classification (e.g. Post-translational, Isotopic label)' },
    { name: 'mass-type', default: 'mono', choices: ['mono', 'avg'], help: 'Match against monoisotopic or average mass' },
    { name: 'include-hidden', type: 'boolean', default: false, help: 'Include hidden specificities (rare/deprecated)' },
    { name: 'limit', type: 'int', default: 20, help: 'Max candidates per query' },
  ],
  columns: ['rank', 'queryMass', 'title', 'accession', 'monoMass', 'deltaFromQuery', 'composition', 'site', 'position', 'classification'],
  func: async (_ctx, args) => {
    const queryMass = Number(args.mass);
    if (!Number.isFinite(queryMass)) {
      throw new ArgumentError(
        `mass must be a finite number, got "${args.mass}"`,
        'Provide a delta mass in Da, e.g. "biocli unimod by-mass 79.9663" or "biocli unimod by-mass -18.0106"',
      );
    }
    // Zero is a no-op (no real modification has mono_mass exactly 0), but we
    // accept it; it will match zero-mass placeholder NeutralLoss entries which
    // is harmless. Negative masses are FIRST-class — Dehydrated (-18.010565),
    // Ammonia-loss (-17.026549), Pyro-glu variants all have negative monoMass
    // in Unimod.

    const tolerance = Number(args.tolerance);
    if (!Number.isFinite(tolerance) || tolerance <= 0) {
      throw new ArgumentError(
        `tolerance must be > 0, got "${args.tolerance}"`,
        'Use e.g. --tolerance 0.01 (Da) or --tolerance 10 --tolerance-unit ppm',
      );
    }

    const unit = String(args['tolerance-unit'] ?? 'Da') as 'Da' | 'ppm';
    // ppm tolerance needs |queryMass| so negative masses compute the same
    // absolute window as their positive counterparts.
    const tolAbs = unit === 'ppm' ? (Math.abs(queryMass) * tolerance) / 1e6 : tolerance;

    const massType = String(args['mass-type'] ?? 'mono') as 'mono' | 'avg';
    const massField: 'monoMass' | 'avgMass' = massType === 'avg' ? 'avgMass' : 'monoMass';

    const filter: SpecificityFilter = {
      residues: parseCsvFilter(args.residue, 'site'),
      positions: parseCsvFilter(args.position, 'lower'),
      classifications: parseCsvFilter(args.classification, 'lower'),
      includeHidden: args['include-hidden'] === true,
    };

    const limit = Math.max(1, Number(args.limit) || 20);

    const index = await loadUnimod();

    const candidates: ByMassRow[] = [];
    for (const mod of index.mods) {
      const modMass = mod[massField];
      if (!Number.isFinite(modMass)) continue;
      if (Math.abs(modMass - queryMass) > tolAbs) continue;
      const matching = mod.specificities.filter(s => specificityMatches(s, filter));
      if (matching.length === 0) continue;
      candidates.push(...flattenMatches(mod, matching, queryMass, tolerance, unit, massField));
    }

    // Sort globally by |delta|, then by site for stable ordering.
    candidates.sort((a, b) => {
      const da = Math.abs(a.deltaFromQuery);
      const db = Math.abs(b.deltaFromQuery);
      if (da !== db) return da - db;
      if (a.site !== b.site) return a.site.localeCompare(b.site);
      return a.classification.localeCompare(b.classification);
    });

    const trimmed = candidates.slice(0, limit);
    trimmed.forEach((row, i) => { row.rank = i + 1; });

    emitAttribution();
    return withMeta(trimmed, { totalCount: candidates.length, query: String(queryMass) });
  },
});
