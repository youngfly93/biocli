/**
 * px/files — List files for a PRIDE-hosted ProteomeXchange dataset.
 *
 * v1 is PRIDE-only. Non-PRIDE accessions (iProX, MassIVE, jPOST) throw
 * `NOT_SUPPORTED` with `EXIT_CODES.SERVICE_UNAVAIL` so scripts and AI
 * agents can distinguish "no files" from "this repo doesn't expose a
 * file API". The error hint includes the repository's web browser URL
 * so users can navigate manually.
 *
 * Pre-flight: one hub REST fetch to determine repository. If PRIDE,
 * proceed to PRIDE `/projects/{acc}/files` for the full file list with
 * FTP/Aspera URLs. Otherwise, fail fast.
 */

import { cli, Strategy } from '../../registry.js';
import { wrapResult } from '../../types.js';
import { CliError, EXIT_CODES, EmptyResultError } from '../../errors.js';
import { createHttpContextForDatabase } from '../../databases/index.js';
import { buildProxiUrl } from '../../databases/proteomexchange.js';
import { buildPrideUrl } from '../../databases/pride.js';
import { validatePxd, isPrideHosted, repoBrowserUrl } from '../_shared/proteomics.js';

/** PRIDE file response CvParam shape. */
interface CvParam {
  '@type'?: string;
  cvLabel?: string;
  accession?: string;
  name?: string;
  value?: string;
}

/** PRIDE /projects/{acc}/files response item shape. */
interface PrideFile {
  accession?: string;
  fileName?: string;
  fileCategory?: CvParam;
  fileSizeBytes?: number;
  checksum?: string;
  publicFileLocations?: CvParam[];
  submissionDate?: string;
  publicationDate?: string;
}

/** Pick the first FTP URL from publicFileLocations, falling back to any value. */
function extractFtpUrl(locations: CvParam[] | undefined): string {
  if (!locations || locations.length === 0) return '';
  const ftp = locations.find(l => (l.name ?? '').toLowerCase().includes('ftp'));
  return String(ftp?.value ?? locations[0]?.value ?? '');
}

/** Format byte count with 2-decimal MB for readability. */
function formatSize(bytes: number | undefined): string {
  if (!bytes || bytes <= 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

cli({
  site: 'px',
  name: 'files',
  description:
    'List files for a PRIDE-hosted ProteomeXchange dataset. ' +
    'v1 supports PRIDE only; iProX/MassIVE/jPOST accessions return a NOT_SUPPORTED error.',
  database: 'aggregate',
  strategy: Strategy.PUBLIC,
  defaultFormat: 'json',
  args: [
    { name: 'accession', positional: true, required: true, help: 'PXD accession (PRIDE-hosted)', producedBy: ['px/search'] },
  ],
  examples: [
    {
      goal: 'List downloadable files for a PRIDE-hosted dataset',
      command: 'biocli px files PXD000001 -f json',
    },
  ],
  func: async (_ctx, args) => {
    const accession = validatePxd(String(args.accession));

    const pxCtx = createHttpContextForDatabase('proteomexchange');
    const prideCtx = createHttpContextForDatabase('pride');

    // Pre-flight: hub REST fetch to determine repository
    const hubRecord = await pxCtx.fetchJson(
      buildProxiUrl(`/datasets/${accession}`),
    ) as Record<string, unknown>;

    if (!hubRecord || Object.keys(hubRecord).length === 0) {
      throw new EmptyResultError(
        `px files ${accession}`,
        `No dataset found for accession "${accession}". Check the accession or try "biocli px search ${accession}".`,
      );
    }

    // Repository lives under datasetSummary.hostingRepository on the REST form.
    const hostingRepository =
      ((hubRecord.datasetSummary as Record<string, unknown> | undefined)?.hostingRepository as string | undefined)
      ?? (hubRecord.repository as string | undefined)
      ?? '';

    if (!isPrideHosted(hostingRepository)) {
      throw new CliError(
        'NOT_SUPPORTED',
        `File listing is not supported for ${hostingRepository || 'non-PRIDE'}-hosted projects in v1.`,
        `${accession} is hosted on ${hostingRepository || 'a non-PRIDE repository'}. ` +
          `v1 supports only PRIDE-hosted datasets for file listing. ` +
          `Visit ${repoBrowserUrl(hostingRepository, accession)} to browse files manually.`,
        EXIT_CODES.SERVICE_UNAVAIL,
      );
    }

    // PRIDE file list fetch
    const files = await prideCtx.fetchJson(
      buildPrideUrl(`/projects/${accession}/files`),
    ) as PrideFile[];

    if (!Array.isArray(files) || files.length === 0) {
      throw new EmptyResultError(
        `px files ${accession}`,
        `PRIDE returned an empty file list for ${accession}. The project may still be under embargo or files may not yet be public.`,
      );
    }

    // Project to flat rows for table output; keep the full object available in wrapResult.
    const rows = files.map(f => ({
      accession: accession,
      fileName: f.fileName ?? '',
      category: f.fileCategory?.name ?? '',
      sizeBytes: f.fileSizeBytes ?? 0,
      sizeHuman: formatSize(f.fileSizeBytes),
      checksum: f.checksum ?? '',
      ftpUrl: extractFtpUrl(f.publicFileLocations),
      submissionDate: f.submissionDate ?? '',
    }));

    return wrapResult(
      rows,
      {
        sources: ['PRIDE'],
        warnings: [],
        query: accession,
        ids: { pxd: accession, hostingRepository: 'PRIDE' },
      },
    );
  },
});
