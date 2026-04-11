/**
 * geo/download — Download GEO supplementary files.
 *
 * GEO stores supplementary files at a predictable HTTPS URL:
 *   https://ftp.ncbi.nlm.nih.gov/geo/series/GSEnnn/GSExxxxx/suppl/
 *
 * This command:
 *   1. Lists available supplementary files for a GSE accession
 *   2. Downloads them to a specified directory (or current dir)
 */

import { cli, Strategy } from '../../registry.js';
import { CliError } from '../../errors.js';
import { mkdirSync, existsSync, createWriteStream, statSync } from 'node:fs';
import { join, basename } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { withMeta } from '../../types.js';

/** Build the GEO FTP-over-HTTPS URL for supplementary files. */
export function buildGeoSupplUrl(accession: string): string {
  // GSE12345 → series/GSE12nnn/GSE12345/suppl/
  const prefix = accession.slice(0, -3) + 'nnn';
  return `https://ftp.ncbi.nlm.nih.gov/geo/series/${prefix}/${accession}/suppl/`;
}

/** Parse file list from NCBI FTP directory listing (HTML). */
export function parseFileList(html: string): { name: string; size: string }[] {
  const files: { name: string; size: string }[] = [];
  // NCBI FTP HTML listings have <a href="filename">filename</a> followed by size info
  const linkRegex = /<a\s+href="([^"]+)">[^<]+<\/a>\s+[\d-]+\s+[\d:]+\s+([\d.]+[KMG]?)/gi;
  let match;
  while ((match = linkRegex.exec(html)) !== null) {
    const name = match[1];
    // Skip parent directory and non-file links
    if (name === '../' || name.endsWith('/') || name.startsWith('?')) continue;
    files.push({ name, size: match[2] });
  }
  return files;
}

cli({
  site: 'geo',
  name: 'download',
  description: 'Download GEO supplementary files (expression matrices, etc.)',
  database: 'gds',
  strategy: Strategy.PUBLIC,
  readOnly: false,
  sideEffects: ['writes-filesystem', 'downloads-remote-files'],
  artifacts: [
    { path: '<outdir>/', kind: 'directory', description: 'Destination directory for downloaded supplementary files' },
  ],
  args: [
    { name: 'accession', positional: true, required: true, help: 'GEO Series accession (e.g. GSE12345)' },
    { name: 'outdir', default: '.', help: 'Output directory (default: current directory)' },
    { name: 'list-only', type: 'boolean', default: false, help: 'Only list available files, do not download' },
    { name: 'dry-run', type: 'boolean', default: false, help: 'Same as --list-only: show files without downloading' },
    { name: 'pattern', help: 'Filter files by pattern (e.g. "counts", "matrix", "tar.gz")' },
  ],
  columns: ['file', 'size', 'status'],
  func: async (ctx, args) => {
    const accession = String(args.accession).toUpperCase().trim();
    if (!/^GSE\d+$/.test(accession)) {
      throw new CliError('ARGUMENT', `Invalid GEO accession: "${accession}"`, 'Use a GSE accession (e.g. GSE12345)');
    }

    const listOnly = Boolean(args['list-only']) || Boolean(args['dry-run']);
    const outdir = String(args.outdir);
    const pattern = args.pattern ? String(args.pattern).toLowerCase() : undefined;

    // Step 1: Get directory listing
    const supplUrl = buildGeoSupplUrl(accession);
    let html: string;
    try {
      html = await ctx.fetchText(supplUrl);
    } catch {
      throw new CliError('NOT_FOUND',
        `No supplementary files found for ${accession}`,
        'The dataset may not have supplementary files, or the accession may be incorrect');
    }

    let files = parseFileList(html);
    if (!files.length) {
      throw new CliError('NOT_FOUND',
        `No downloadable files found at ${supplUrl}`,
        'The directory listing may be empty or in an unexpected format');
    }

    // Filter by pattern if specified
    if (pattern) {
      files = files.filter(f => f.name.toLowerCase().includes(pattern));
      if (!files.length) {
        throw new CliError('NOT_FOUND',
          `No files matching "${pattern}" in ${accession}`,
          'Try without --pattern to see all available files');
      }
    }

    // List-only mode
    if (listOnly) {
      const rows = files.map(f => ({
        file: f.name,
        size: f.size,
        status: 'available',
        url: `${supplUrl}${f.name}`,
      }));
      return withMeta(rows, { totalCount: rows.length, query: accession });
    }

    // Step 2: Download files
    if (!existsSync(outdir)) {
      mkdirSync(outdir, { recursive: true });
    }

    const rows: { file: string; size: string; status: string }[] = [];

    for (const file of files) {
      const fileUrl = `${supplUrl}${file.name}`;
      const destPath = join(outdir, file.name);

      // Resume: skip only if local file matches expected remote size
      if (existsSync(destPath) && statSync(destPath).size > 0) {
        try {
          const head = await fetch(fileUrl, { method: 'HEAD' });
          if (head.ok) {
            const expectedSize = Number(head.headers.get('content-length') ?? 0);
            const localSize = statSync(destPath).size;
            if (expectedSize > 0 && localSize === expectedSize) {
              rows.push({ file: file.name, size: file.size, status: `skipped (complete)` });
              continue;
            }
            // Incomplete or mismatched — will re-download below
          }
        } catch {
          // HEAD failed — proceed with download
        }
      }

      try {
        const response = await fetch(fileUrl);
        if (!response.ok || !response.body) {
          rows.push({ file: file.name, size: file.size, status: `failed (HTTP ${response.status})` });
          continue;
        }

        const writable = createWriteStream(destPath);
        await pipeline(Readable.fromWeb(response.body as any), writable);
        rows.push({ file: file.name, size: file.size, status: `saved → ${destPath}` });
      } catch (err) {
        rows.push({ file: file.name, size: file.size, status: `error: ${err instanceof Error ? err.message : String(err)}` });
      }
    }

    return withMeta(rows, { totalCount: rows.length, query: accession });
  },
});
