/**
 * biocli unimod search — Find modifications by free-text query.
 *
 * Case-insensitive substring match across title, full name, and alt names.
 * With `--exact`, only exact lowercase equality on title or full name.
 *
 * Data: Unimod (https://www.unimod.org), Design Science License.
 */

import { cli } from '../../registry.js';
import { withMeta } from '../../types.js';
import { loadUnimod, type UnimodMod } from '../../datasets/unimod.js';
import { emitAttribution } from './_shared.js';

function matches(mod: UnimodMod, needle: string, exact: boolean): boolean {
  const n = needle.toLowerCase();
  if (exact) {
    return mod.title.toLowerCase() === n || mod.fullName.toLowerCase() === n;
  }
  if (mod.title.toLowerCase().includes(n)) return true;
  if (mod.fullName.toLowerCase().includes(n)) return true;
  for (const alt of mod.altNames) {
    if (alt.toLowerCase().includes(n)) return true;
  }
  return false;
}

cli({
  site: 'unimod',
  name: 'search',
  database: 'unimod',
  noContext: true,
  description:
    'Search Unimod modifications by title, full name, or alternate name (substring match). ' +
    'Data: Unimod (https://www.unimod.org), Design Science License.',
  args: [
    { name: 'query', positional: true, required: true, help: 'Search term (e.g. "phospho", "silac", "tmt")' },
    { name: 'limit', type: 'int', default: 20, help: 'Max number of results' },
    { name: 'exact', type: 'boolean', default: false, help: 'Require exact match on title or full name' },
  ],
  columns: ['accession', 'title', 'fullName', 'monoMass', 'composition', 'altNames'],
  func: async (_ctx, args) => {
    const query = String(args.query ?? '').trim();
    if (!query) {
      emitAttribution();
      return withMeta([], { totalCount: 0, query });
    }

    const exact = args.exact === true;
    const limit = Math.max(1, Number(args.limit) || 20);
    const index = await loadUnimod();

    const matched: UnimodMod[] = [];
    for (const mod of index.mods) {
      if (matches(mod, query, exact)) {
        matched.push(mod);
        if (matched.length >= limit) break;
      }
    }

    const rows = matched.map(mod => ({
      accession: mod.accession,
      title: mod.title,
      fullName: mod.fullName,
      monoMass: mod.monoMass,
      composition: mod.composition,
      altNames: mod.altNames.join('; '),
    }));

    emitAttribution();
    return withMeta(rows, { totalCount: rows.length, query });
  },
});
