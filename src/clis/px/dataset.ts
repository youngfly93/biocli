/**
 * px/dataset — Fetch full metadata for a single ProteomeXchange dataset.
 *
 * Two-step lookup:
 *
 *   1. Hub REST fetch `/datasets/{accession}` on ProteomeCentral. Returns
 *      the rich nested hub record (contacts, modifications, files, etc.).
 *      Note: hub supports REST-path style for single records — the query-
 *      string `?accession=` form is SILENTLY IGNORED, which is why we use
 *      path-style here.
 *
 *   2. If the hub record's `repository` is PRIDE, upgrade with the PRIDE
 *      `/projects/{accession}` endpoint to get the 25-field rich metadata
 *      including `identifiedPTMStrings`, sample protocols, quantification
 *      methods, etc. Graceful fallback to hub-only + warning if PRIDE fails.
 *      Users can pass `--no-detailed` to skip the upgrade.
 *
 * Declares `database: 'aggregate'` because it orchestrates two backends
 * and we want to bypass the 24h response cache — a transient PRIDE outage
 * must not cache a degraded result for a full day.
 */

import { cli, Strategy } from '../../registry.js';
import { wrapResult } from '../../types.js';
import { EmptyResultError } from '../../errors.js';
import { createHttpContextForDatabase } from '../../databases/index.js';
import { buildProxiUrl } from '../../databases/proteomexchange.js';
import { validatePxd } from '../_shared/proteomics.js';
import { upgradeToPride } from '../_shared/px-upgrade.js';

cli({
  site: 'px',
  name: 'dataset',
  description:
    'Fetch full metadata for a ProteomeXchange dataset by PXD accession. ' +
    'Hub-first, automatically upgraded with PRIDE detail when the dataset ' +
    'is PRIDE-hosted.',
  database: 'aggregate',
  strategy: Strategy.PUBLIC,
  defaultFormat: 'json',
  args: [
    { name: 'accession', positional: true, required: true, help: 'PXD accession (e.g. PXD000001)' },
    {
      name: 'detailed',
      type: 'boolean',
      default: true,
      help: 'Upgrade with PRIDE detail when available. Use --detailed false to skip and return hub-only metadata.',
    },
  ],
  func: async (_ctx, args) => {
    const accession = validatePxd(String(args.accession));
    const detailed = args.detailed !== false;

    const pxCtx = createHttpContextForDatabase('proteomexchange');
    const prideCtx = createHttpContextForDatabase('pride');

    // Step 1: hub REST-style fetch. The path form works; query-string ?accession= does NOT.
    const hubRecord = await pxCtx.fetchJson(
      buildProxiUrl(`/datasets/${accession}`),
    ) as Record<string, unknown>;

    if (!hubRecord || Object.keys(hubRecord).length === 0) {
      throw new EmptyResultError(
        `px dataset ${accession}`,
        `No dataset found for accession "${accession}" in the ProteomeXchange hub. ` +
        `Check the accession or try "biocli px search ${accession}".`,
      );
    }

    // Hub REST responses don't carry a top-level `repository` field — it lives
    // under datasetSummary.hostingRepository. Normalize so upgradeToPride() can
    // see it through the standard `.repository` property.
    const hostingRepository =
      (hubRecord.repository as string | undefined)
      ?? ((hubRecord.datasetSummary as Record<string, unknown> | undefined)?.hostingRepository as string | undefined)
      ?? '';
    const normalizedHub: Record<string, unknown> = {
      ...hubRecord,
      accession,
      repository: hostingRepository,
    };

    // Step 2: optionally upgrade with PRIDE detail
    const sources: string[] = ['ProteomeXchange'];
    let warnings: string[] = [];
    let finalRecord: Record<string, unknown> = normalizedHub;
    let repositoryStatus: 'native' | 'degraded' | 'hub-only' = 'hub-only';

    if (detailed) {
      const upgraded = await upgradeToPride(normalizedHub, { pxCtx, prideCtx });
      finalRecord = upgraded.record;
      repositoryStatus = upgraded.status;
      warnings = upgraded.warnings;
      if (upgraded.status === 'native') {
        sources.push('PRIDE');
      }
    } else {
      // User opted out — record that fact in the envelope
      repositoryStatus = 'hub-only';
    }

    return wrapResult(
      { ...finalRecord, repositoryStatus },
      {
        sources,
        warnings,
        query: accession,
        ids: { pxd: accession, hostingRepository },
        completeness: repositoryStatus === 'degraded' ? 'degraded' : undefined,
      },
    );
  },
});
