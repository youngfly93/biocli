/**
 * biocli unimod fetch — Look up one Unimod modification by accession or name.
 *
 * Mirrors the convention of `biocli pubmed fetch <pmid>`,
 * `biocli uniprot fetch <accession>`, etc. — given a single identifier,
 * return the full record.
 *
 * Accepted forms:
 *   biocli unimod fetch 21          → UNIMOD:21 (Phospho)
 *   biocli unimod fetch UNIMOD:21   → same
 *   biocli unimod fetch Phospho     → exact-match on title (case-insensitive)
 *
 * The result includes the full set of specificities (one row per
 * specificity, like by-mass and by-residue, for a consistent shape across
 * unimod commands). All rows share the same modification metadata.
 *
 * Data: Unimod (https://www.unimod.org), Design Science License.
 */

import { cli } from '../../registry.js';
import { withMeta } from '../../types.js';
import { ArgumentError, EmptyResultError } from '../../errors.js';
import { loadUnimod, type UnimodMod } from '../../datasets/unimod.js';
import { emitAttribution } from './_shared.js';

/** Parse a user-supplied identifier into either a record_id or a title. */
function parseAccession(raw: string): { recordId?: number; title?: string } {
  const trimmed = raw.trim();
  if (!trimmed) return {};
  // "UNIMOD:21" or "unimod:21"
  const colonMatch = /^unimod:(\d+)$/i.exec(trimmed);
  if (colonMatch) return { recordId: Number(colonMatch[1]) };
  // Plain integer
  if (/^\d+$/.test(trimmed)) return { recordId: Number(trimmed) };
  // Anything else: treat as a title (case-insensitive exact match)
  return { title: trimmed.toLowerCase() };
}

cli({
  site: 'unimod',
  name: 'fetch',
  database: 'unimod',
  noContext: true,
  description:
    'Look up one Unimod modification by accession (UNIMOD:21 / 21) or title (Phospho). ' +
    'Data: Unimod (https://www.unimod.org), Design Science License.',
  args: [
    {
      name: 'accession',
      positional: true,
      required: true,
      help: 'UNIMOD:<n>, plain integer, or exact title (e.g. "Phospho")',
    },
  ],
  columns: [
    'accession', 'title', 'fullName', 'monoMass', 'avgMass', 'composition',
    'site', 'position', 'classification', 'hidden', 'neutralLossMono',
  ],
  func: async (_ctx, args) => {
    const raw = String(args.accession ?? '').trim();
    if (!raw) {
      throw new ArgumentError(
        'accession is required',
        'Pass a UNIMOD accession (e.g. UNIMOD:21), a plain integer (21), or a modification title (Phospho)',
      );
    }

    const { recordId, title } = parseAccession(raw);

    const index = await loadUnimod();
    let mod: UnimodMod | undefined;
    if (recordId !== undefined) {
      mod = index.byRecordId.get(recordId);
    } else if (title !== undefined) {
      mod = index.byTitleLower.get(title);
    }

    if (!mod) {
      throw new EmptyResultError(
        `unimod fetch ${raw}`,
        `No modification matched "${raw}". ` +
          `Try "biocli unimod search ${raw}" for substring lookup, or "biocli unimod list" to browse.`,
      );
    }

    // Flatten one row per specificity for a consistent shape with by-mass /
    // by-residue. Single-spec mods produce a single row.
    const rows = mod.specificities.length === 0
      ? [{
          accession: mod.accession,
          recordId: mod.recordId,
          title: mod.title,
          fullName: mod.fullName,
          approved: mod.approved,
          monoMass: mod.monoMass,
          avgMass: mod.avgMass,
          composition: mod.composition,
          site: '',
          position: '',
          classification: '',
          hidden: false,
          neutralLossMono: null as number | null,
          neutralLossComposition: null as string | null,
          altNames: mod.altNames.join('; '),
          xrefs: mod.xrefs.map(x => `${x.source}:${x.text}`).join('; '),
        }]
      : mod.specificities.map(spec => ({
          accession: mod!.accession,
          recordId: mod!.recordId,
          title: mod!.title,
          fullName: mod!.fullName,
          approved: mod!.approved,
          monoMass: mod!.monoMass,
          avgMass: mod!.avgMass,
          composition: mod!.composition,
          site: spec.site,
          position: spec.position,
          classification: spec.classification,
          hidden: spec.hidden,
          neutralLossMono: spec.neutralLossMono ?? null,
          neutralLossComposition: spec.neutralLossComposition ?? null,
          altNames: mod!.altNames.join('; '),
          xrefs: mod!.xrefs.map(x => `${x.source}:${x.text}`).join('; '),
        }));

    emitAttribution();
    return withMeta(rows, { totalCount: rows.length, query: raw });
  },
});
