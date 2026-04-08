/**
 * biocli unimod by-residue — List modifications targeting a specific amino acid.
 *
 * Takes a positional residue (e.g. "S", "N-term", "C-term") plus optional
 * position / classification filters. Returns one row per `(mod, matching
 * specificity)` tuple — the same flattening shape as by-mass (minus the
 * mass-query fields), so consumers joining both outputs see a consistent
 * schema.
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

interface ByResidueRow {
  queryResidue: string;
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
}

function flatten(
  mod: UnimodMod,
  matching: UnimodSpecificity[],
  queryResidue: string,
): ByResidueRow[] {
  return matching.map(spec => ({
    queryResidue,
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
  }));
}

cli({
  site: 'unimod',
  name: 'by-residue',
  database: 'unimod',
  description:
    'List Unimod modifications that can occur on a given amino acid (e.g. S, K, N-term). ' +
    'Data: Unimod (https://www.unimod.org), Design Science License.',
  args: [
    { name: 'residue', positional: true, required: true, help: 'Amino acid letter (e.g. S) or N-term / C-term' },
    { name: 'position', help: 'Filter by position (Anywhere, Any N-term, Protein N-term, …)' },
    { name: 'classification', help: 'Filter by classification (e.g. Post-translational, Isotopic label)' },
    { name: 'include-hidden', type: 'boolean', default: false, help: 'Include hidden specificities (rare/deprecated)' },
    { name: 'limit', type: 'int', default: 100, help: 'Max rows to return' },
  ],
  columns: ['title', 'accession', 'monoMass', 'composition', 'site', 'position', 'classification'],
  func: async (_ctx, args) => {
    const rawResidue = String(args.residue ?? '').trim();
    if (!rawResidue) {
      throw new ArgumentError(
        'residue is required',
        'Pass a single amino acid (e.g. "S"), or "N-term" / "C-term"',
      );
    }
    // Normalize to uppercase for single-letter residues, keep N-term / C-term intact.
    const queryResidue = rawResidue.length === 1 ? rawResidue.toUpperCase() : rawResidue;

    const filter: SpecificityFilter = {
      residues: new Set([queryResidue]),
      positions: parseCsvFilter(args.position, 'lower'),
      classifications: parseCsvFilter(args.classification, 'lower'),
      includeHidden: args['include-hidden'] === true,
    };

    const limit = Math.max(1, Number(args.limit) || 100);
    const index = await loadUnimod();

    const rows: ByResidueRow[] = [];
    for (const mod of index.mods) {
      const matching = mod.specificities.filter(s => specificityMatches(s, filter));
      if (matching.length === 0) continue;
      rows.push(...flatten(mod, matching, queryResidue));
      if (rows.length >= limit) break;
    }

    const trimmed = rows.slice(0, limit);

    emitAttribution();
    return withMeta(trimmed, { totalCount: trimmed.length, query: queryResidue });
  },
});
