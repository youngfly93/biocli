/**
 * aggregate/ptm-datasets — Find ProteomeXchange datasets reporting a
 * specific PTM on a specific gene.
 *
 * Fuses `unimod` (the modification dictionary) with `px search` (the
 * consortium dataset index). Input is a gene symbol + a modification
 * short name; output is a ranked PXD list.
 *
 * Uses the PROXI TYPED `?modification=` filter + `?keywords=<gene>` for
 * the intersection. (IMPORTANT: PROXI's `search=` parameter ignores
 * `modification=` when present — composition only works via `keywords=`.
 * Confirmed via live probing: `search=TP53&modification=Phospho` returned
 * 28 rows — identical to `search=TP53` alone, proving modification is
 * ignored. Meanwhile `keywords=TP53&modification=Phospho` correctly
 * intersected to 12 rows.)
 *
 * v1 limitations (documented in --help and in the BiocliResult warnings):
 *   - The gene must appear in the dataset's declared keyword list, not
 *     just the title/description. Datasets where the gene is only
 *     mentioned in the abstract will be missed.
 *   - False positives are possible (e.g. "TP53" keyword may match a
 *     dataset about TP53BP1 if the submitter tagged both).
 *   - No cross-repo ranking. Order is whatever PROXI returns (announce date).
 *   - Only a single search strategy. A v2 version could fan out and dedupe.
 */

import { cli, Strategy } from '../../registry.js';
import { wrapResult } from '../../types.js';
import { ArgumentError, EmptyResultError } from '../../errors.js';
import { createHttpContextForDatabase } from '../../databases/index.js';
import { buildProxiUrl } from '../../databases/proteomexchange.js';

/**
 * Map short modification names to the PROXI `modification` filter value.
 * PROXI honors specific modification class names like "Phospho", "Methyl",
 * "Acetyl" directly via ?modification=.
 */
const MODIFICATION_ALIAS: Record<string, string> = {
  phospho: 'Phospho',
  phosphorylation: 'Phospho',
  methyl: 'Methyl',
  methylation: 'Methyl',
  acetyl: 'Acetyl',
  acetylation: 'Acetyl',
  ubiq: 'GlyGly',
  ubiquitin: 'GlyGly',
  ubiquitination: 'GlyGly',
  glycan: 'Glycosylation',
  glycosylation: 'Glycosylation',
  oxidation: 'Oxidation',
  succinyl: 'Succinyl',
  succinylation: 'Succinyl',
  sumo: 'SUMO',
  sumoylation: 'SUMO',
};

const SUPPORTED_MODIFICATIONS = Object.keys(MODIFICATION_ALIAS);

/** PROXI row → flat object using the compact format column list. */
function rowToObject(row: unknown[], columnHeaders: string[]): Record<string, unknown> {
  const alias: Record<string, string> = {
    'dataset identifier': 'accession',
    'title': 'title',
    'repository': 'repository',
    'species': 'species',
    'SDRF': 'sdrf',
    'files (raw/total)': 'filesCount',
    'instrument': 'instruments',
    'publications': 'publications',
    'lab head': 'labHead',
    'announce date': 'announceDate',
    'keywords': 'keywords',
  };
  const obj: Record<string, unknown> = {};
  for (let i = 0; i < columnHeaders.length; i++) {
    const key = alias[columnHeaders[i]] ?? columnHeaders[i];
    obj[key] = row[i] ?? null;
  }
  return obj;
}

interface ProxiResponse {
  datasets?: unknown[][];
  result_set?: { datasets_title_list?: string[]; n_available_rows?: number };
}

cli({
  site: 'aggregate',
  name: 'ptm-datasets',
  description:
    'Find ProteomeXchange datasets reporting a specific PTM on a specific gene. ' +
    'Fuses Unimod modification names with PROXI dataset search. ' +
    'v1 uses keyword matching so false positives are possible.',
  database: 'aggregate',
  strategy: Strategy.PUBLIC,
  defaultFormat: 'json',
  args: [
    { name: 'gene', positional: true, required: true, help: 'Gene symbol or free-text query (e.g. TP53, MDMX)' },
    {
      name: 'modification',
      required: true,
      help: `PTM type. One of: ${SUPPORTED_MODIFICATIONS.join(', ')}.`,
    },
    { name: 'repository', choices: ['PRIDE', 'iProX', 'MassIVE', 'jPOST'], help: 'Restrict to one repository' },
    { name: 'limit', type: 'int', default: 20, help: 'Max datasets to return' },
  ],
  func: async (_ctx, args) => {
    const gene = String(args.gene).trim();
    if (!gene) {
      throw new ArgumentError('gene is required');
    }

    const modKey = String(args.modification ?? '').trim().toLowerCase();
    const modification = MODIFICATION_ALIAS[modKey];
    if (!modification) {
      throw new ArgumentError(
        `Unsupported modification: "${args.modification}"`,
        `Supported values: ${SUPPORTED_MODIFICATIONS.join(', ')}. The short name is mapped to the PROXI filter value.`,
      );
    }

    const limit = Math.max(1, Math.min(500, Number(args.limit) || 20));
    const repository = args.repository ? String(args.repository) : undefined;

    const pxCtx = createHttpContextForDatabase('proteomexchange');

    // CRITICAL: Use `keywords=` not `search=` for the gene.
    // PROXI silently drops the `modification=` filter when `search=` is
    // present; the composition only works through the keyword field.
    const url = buildProxiUrl('/datasets', {
      keywords: gene,
      modification,
      repository,
      pageSize: String(limit),
      pageNumber: '1',
    });

    const response = await pxCtx.fetchJson(url) as ProxiResponse;
    const columnHeaders = response.result_set?.datasets_title_list ?? [];
    const rawRows = response.datasets ?? [];

    if (rawRows.length === 0) {
      throw new EmptyResultError(
        `aggregate ptm-datasets ${gene} --modification ${modification}`,
        `No ProteomeXchange datasets matched gene="${gene}" with modification="${modification}". ` +
          `Try a broader gene query or a different modification short name.`,
      );
    }

    const datasets = rawRows.map(row => rowToObject(row as unknown[], columnHeaders));

    // Sort by announceDate desc (PROXI seems to honor this already, but be explicit).
    datasets.sort((a, b) => {
      const da = String(a.announceDate ?? '');
      const db = String(b.announceDate ?? '');
      return db.localeCompare(da);
    });

    const totalCount = response.result_set?.n_available_rows ?? datasets.length;

    return wrapResult(
      {
        datasets,
        gene,
        modification,
        repository: repository ?? 'any',
        totalAvailable: totalCount,
      },
      {
        sources: ['ProteomeXchange'],
        warnings: [
          'v1 filters by the dataset\'s declared keywords + modification type. ' +
          'Datasets where the gene appears only in the title or description ' +
          '(not tagged as a keyword) will be missed. False positives are also ' +
          'possible (e.g. "TP53" may match TP53BP1-tagged projects). Inspect ' +
          'titles and keywords before relying on the list.',
        ],
        query: gene,
        ids: { gene, modification },
      },
    );
  },
});
