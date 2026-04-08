/**
 * Shared proteomics helpers: PXD accession validation + repository classification.
 *
 * Used by all `px` site commands and by the `aggregate ptm-datasets` workflow.
 * Centralized here so the regex and classification logic stays consistent across
 * commands.
 */

import { ArgumentError } from '../../errors.js';

/**
 * PXD accession format: "PXD" + 6 or 7 digits (current allocation is 6–7 wide).
 *
 * Examples: PXD000001, PXD1234567 (both valid)
 * Rejects:  PXD0 (too short), PXD12345678 (too long),
 *           MSV000079514 (MassIVE native), IPX... (iProX native)
 */
export const PXD_REGEX = /^PXD\d{6,7}$/i;

/**
 * Validate and canonicalize a user-supplied PXD accession.
 *
 * Returns the normalized uppercase form. Throws ArgumentError with a
 * helpful hint for non-PXD identifiers (MSV, IPX, JPST) — v1 supports
 * PXD-only, cross-id resolution is v2 work.
 */
export function validatePxd(input: string): string {
  const trimmed = input.trim().toUpperCase();
  if (!PXD_REGEX.test(trimmed)) {
    const hint = /^MSV\d+$/i.test(trimmed)
      ? `v1 supports PXD accessions only. "${input}" looks like a MassIVE id; use "biocli px search ${input}" to resolve it to a PXD.`
      : /^IPX\d+$/i.test(trimmed)
      ? `v1 supports PXD accessions only. "${input}" looks like an iProX id; use "biocli px search ${input}" to resolve it to a PXD.`
      : /^JPST\d+$/i.test(trimmed)
      ? `v1 supports PXD accessions only. "${input}" looks like a jPOST id; use "biocli px search ${input}" to resolve it to a PXD.`
      : `v1 supports PXD accessions only (e.g. PXD000001). Use "biocli px search <query>" for free-text search.`;
    throw new ArgumentError(
      `Invalid PXD accession: "${input}"`,
      hint,
    );
  }
  return trimmed;
}

/**
 * Check whether a repository name indicates PRIDE-hosted data.
 * Case-insensitive since the hub uses mixed casing across endpoints.
 */
export function isPrideHosted(repository: string | undefined | null): boolean {
  return (repository ?? '').toUpperCase() === 'PRIDE';
}

/**
 * Best-effort URL to the repository's web browser page for an accession.
 * Used in error hints when a command can't process a non-PRIDE accession.
 */
export function repoBrowserUrl(repository: string | undefined, accession: string): string {
  const repo = (repository ?? '').toLowerCase();
  if (repo === 'pride') {
    return `https://www.ebi.ac.uk/pride/archive/projects/${accession}`;
  }
  if (repo === 'iprox') {
    return `https://www.iprox.cn/page/project.html?id=${accession}`;
  }
  if (repo === 'massive') {
    return `https://massive.ucsd.edu/ProteoSAFe/dataset.jsp?accession=${accession}`;
  }
  if (repo === 'jpost') {
    return `https://repository.jpostdb.org/entry/${accession}`;
  }
  return `https://proteomecentral.proteomexchange.org/dataset/show?ID=${accession}`;
}
