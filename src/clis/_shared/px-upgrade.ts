/**
 * Pure helper: upgrade a ProteomeXchange hub record with rich PRIDE detail.
 *
 * When the hub record's `repository` field is "PRIDE", calls the PRIDE
 * Archive API for the full 25-field project metadata and merges it into
 * the hub record. For non-PRIDE repos (iProX, MassIVE, jPOST) this is a
 * no-op that returns the hub record unchanged — those repos don't have
 * equivalent REST APIs.
 *
 * On PRIDE API failure (5xx after backend retries, 404, network timeout)
 * the helper gracefully degrades to hub-only data and populates a warning.
 * This lets commands surface "you got hub-only because PRIDE was down"
 * through the BiocliResult.warnings channel without failing the whole call.
 *
 * Status semantics:
 *   - "native"   → PRIDE repo + upgrade succeeded (merged rich record)
 *   - "degraded" → PRIDE repo + upgrade failed (hub-only record + warning)
 *   - "hub-only" → non-PRIDE repo (no upgrade attempted, no warning)
 */

import type { HttpContext } from '../../types.js';
import { getErrorMessage } from '../../errors.js';
import { buildPrideUrl } from '../../databases/pride.js';
import { isPrideHosted } from './proteomics.js';

export type UpgradeStatus = 'native' | 'degraded' | 'hub-only';

export interface UpgradedRecord {
  /** Merged record: hub base + PRIDE overlay (if status === 'native'). */
  record: Record<string, unknown>;
  /** Which upgrade path ran and whether it succeeded. */
  status: UpgradeStatus;
  /** Human-readable warnings for the BiocliResult envelope. */
  warnings: string[];
}

export interface UpgradeContexts {
  /** ProteomeXchange hub context (unused currently but kept for API symmetry). */
  pxCtx: HttpContext;
  /** PRIDE Archive context — used for the detail upgrade. */
  prideCtx: HttpContext;
}

/**
 * Upgrade a hub dataset record to include rich PRIDE metadata if applicable.
 *
 * @param hubRecord  The dataset object (possibly zipped from PROXI compact rows,
 *                   possibly already a rich REST record). Must have at least
 *                   `repository` and `accession` fields.
 * @param contexts   HttpContexts for both PROXI and PRIDE. Allows tests to inject
 *                   mocks for either backend independently.
 */
export async function upgradeToPride(
  hubRecord: Record<string, unknown>,
  contexts: UpgradeContexts,
): Promise<UpgradedRecord> {
  const repository = typeof hubRecord.repository === 'string'
    ? hubRecord.repository
    : '';

  // Non-PRIDE repositories have no equivalent detail API — return hub data as-is.
  if (!isPrideHosted(repository)) {
    return { record: hubRecord, status: 'hub-only', warnings: [] };
  }

  const accession = typeof hubRecord.accession === 'string'
    ? hubRecord.accession
    : '';

  if (!accession) {
    return {
      record: hubRecord,
      status: 'degraded',
      warnings: ['Cannot upgrade to PRIDE detail: hub record has no accession field.'],
    };
  }

  try {
    const detailed = await contexts.prideCtx.fetchJson(
      buildPrideUrl(`/projects/${accession}`),
    ) as Record<string, unknown>;
    return {
      // PRIDE detail fields override hub columns where they collide
      // (title, description, keywords etc. are richer from PRIDE).
      record: { ...hubRecord, ...detailed },
      status: 'native',
      warnings: [],
    };
  } catch (err) {
    return {
      record: hubRecord,
      status: 'degraded',
      warnings: [
        `PRIDE detail upgrade failed for ${accession}: ${getErrorMessage(err)}. Returning hub-only metadata.`,
      ],
    };
  }
}
