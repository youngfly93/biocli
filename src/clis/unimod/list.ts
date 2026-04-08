/**
 * biocli unimod list — List modifications from the local Unimod cache.
 *
 * Supports filtering by residue / position / classification. Each filter
 * accepts a comma-separated list; a mod passes if ANY of its specificities
 * pass ALL filters. Hidden specificities are excluded by default.
 *
 * Data: Unimod (https://www.unimod.org), Design Science License.
 */

import { cli } from '../../registry.js';
import { withMeta } from '../../types.js';
import { loadUnimod } from '../../datasets/unimod.js';
import {
  parseCsvFilter,
  matchingSpecificities,
  emitAttribution,
  joinDistinct,
  type SpecificityFilter,
} from './_shared.js';

cli({
  site: 'unimod',
  name: 'list',
  database: 'unimod',
  noContext: true,
  description:
    'List Unimod modifications with optional filters. ' +
    'Data: Unimod (https://www.unimod.org), Design Science License.',
  args: [
    { name: 'residue', help: 'Filter by amino acid (e.g. S,T,Y) or N-term/C-term' },
    { name: 'position', help: 'Filter by position (Anywhere, Any N-term, Protein N-term, …)' },
    { name: 'classification', help: 'Filter by classification (e.g. Post-translational, Isotopic label)' },
    { name: 'limit', type: 'int', default: 50, help: 'Max number of modifications to return' },
    { name: 'include-hidden', type: 'boolean', default: false, help: 'Include hidden specificities (rare/deprecated)' },
  ],
  columns: ['accession', 'title', 'fullName', 'monoMass', 'composition', 'sites', 'classifications', 'approved'],
  func: async (_ctx, args) => {
    const index = await loadUnimod();

    const filter: SpecificityFilter = {
      residues: parseCsvFilter(args.residue, 'site'),
      positions: parseCsvFilter(args.position, 'lower'),
      classifications: parseCsvFilter(args.classification, 'lower'),
      includeHidden: args['include-hidden'] === true,
    };

    const limit = Math.max(1, Number(args.limit) || 50);
    const rows: Record<string, unknown>[] = [];

    for (const mod of index.mods) {
      const matching = matchingSpecificities(mod, filter);
      if (matching.length === 0) continue;
      rows.push({
        accession: mod.accession,
        title: mod.title,
        fullName: mod.fullName,
        monoMass: mod.monoMass,
        composition: mod.composition,
        sites: joinDistinct(matching, 'site'),
        positions: joinDistinct(matching, 'position'),
        classifications: joinDistinct(matching, 'classification'),
        approved: mod.approved,
      });
      if (rows.length >= limit) break;
    }

    emitAttribution();
    return withMeta(rows, { totalCount: rows.length });
  },
});
