/**
 * sra/download — Download FASTQ files for an SRA run.
 *
 * Two download strategies:
 *   1. ENA HTTPS (default, no external tools needed):
 *      https://ftp.sra.ebi.ac.uk/vol1/fastq/SRR123/SRR1234567/SRR1234567_1.fastq.gz
 *
 *   2. sra-tools (fallback, requires prefetch + fasterq-dump):
 *      prefetch SRR1234567 && fasterq-dump SRR1234567
 *
 * ENA is preferred because it downloads compressed FASTQ directly
 * without needing sra-tools installed.
 */

import { cli, Strategy } from '../../registry.js';
import { CliError } from '../../errors.js';
import { mkdirSync, existsSync, createWriteStream } from 'node:fs';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { execSync } from 'node:child_process';

/** Build ENA FASTQ download URLs for an SRR accession. */
function buildEnaFastqUrls(accession: string): string[] {
  // ENA URL pattern: /vol1/fastq/SRR123/[NNN/]SRR1234567/
  // Sub-directory depends on total accession length:
  //   <= 9 chars (e.g. SRR039885):  no sub-directory
  //   10 chars  (e.g. SRR1039508): /00N/ where N = last digit
  //   11 chars  (e.g. SRR10395085): /0NN/ where NN = last 2 digits
  //   >= 12 chars: /NNN/ where NNN = last 3 digits
  const prefix = accession.slice(0, 6); // e.g. SRR103

  let subDir = '';
  if (accession.length === 10) {
    subDir = `/00${accession.slice(-1)}`;
  } else if (accession.length === 11) {
    subDir = `/0${accession.slice(-2)}`;
  } else if (accession.length >= 12) {
    subDir = `/${accession.slice(-3)}`;
  }

  const base = `https://ftp.sra.ebi.ac.uk/vol1/fastq/${prefix}${subDir}/${accession}`;
  return [
    `${base}/${accession}.fastq.gz`,       // single-end
    `${base}/${accession}_1.fastq.gz`,      // paired-end read 1
    `${base}/${accession}_2.fastq.gz`,      // paired-end read 2
  ];
}

/** Check if a command exists on PATH. */
function commandExists(cmd: string): boolean {
  try {
    execSync(`which ${cmd}`, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/** Download a file. Returns { ok, size, notFound } to distinguish 404 from real errors. */
async function downloadFile(url: string, destPath: string): Promise<{ ok: boolean; size: number; notFound: boolean }> {
  const response = await fetch(url);
  if (response.status === 404) {
    return { ok: false, size: 0, notFound: true };
  }
  if (!response.ok || !response.body) {
    return { ok: false, size: 0, notFound: false };
  }

  const writable = createWriteStream(destPath);
  await pipeline(Readable.fromWeb(response.body as any), writable);

  const contentLength = response.headers.get('content-length');
  return { ok: true, size: contentLength ? Number(contentLength) : 0, notFound: false };
}

function formatSize(bytes: number): string {
  if (bytes === 0) return 'unknown size';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

cli({
  site: 'sra',
  name: 'download',
  description: 'Download FASTQ files for an SRA run (via ENA or sra-tools)',
  database: 'sra',
  strategy: Strategy.PUBLIC,
  timeoutSeconds: 600,
  args: [
    { name: 'accession', positional: true, required: true, help: 'SRA run accession (e.g. SRR1234567)' },
    { name: 'outdir', default: '.', help: 'Output directory (default: current directory)' },
    { name: 'method', default: 'ena', choices: ['ena', 'sra-tools'], help: 'Download method' },
  ],
  columns: ['file', 'size', 'status'],
  func: async (_ctx, args) => {
    const accession = String(args.accession).trim();
    const outdir = String(args.outdir);
    const method = String(args.method);

    if (!/^[SDE]RR\d+$/i.test(accession)) {
      throw new CliError('ARGUMENT',
        `Invalid SRA run accession: "${accession}"`,
        'Use a run accession starting with SRR, ERR, or DRR (e.g. SRR1234567)');
    }

    if (!existsSync(outdir)) {
      mkdirSync(outdir, { recursive: true });
    }

    // Method 1: ENA HTTPS download
    if (method === 'ena') {
      const urls = buildEnaFastqUrls(accession);
      const rows: { file: string; size: string; status: string }[] = [];
      const errors: string[] = [];

      for (const url of urls) {
        const fileName = url.split('/').pop()!;
        const destPath = join(outdir, fileName);

        try {
          const result = await downloadFile(url, destPath);
          if (result.ok) {
            rows.push({ file: fileName, size: formatSize(result.size), status: `saved → ${destPath}` });
          } else if (!result.notFound) {
            // Non-404 failure is a real error (network issue, server error)
            errors.push(`${fileName}: HTTP error`);
            rows.push({ file: fileName, size: '', status: 'failed' });
          }
          // 404 is expected: single-end has no _1/_2, paired-end has no plain .fastq.gz
        } catch (err) {
          // Network/write errors are real failures, not expected 404s
          const msg = err instanceof Error ? err.message : String(err);
          errors.push(`${fileName}: ${msg}`);
          rows.push({ file: fileName, size: '', status: `error: ${msg}` });
        }
      }

      const successCount = rows.filter(r => r.status.startsWith('saved')).length;

      if (successCount === 0) {
        throw new CliError('NOT_FOUND',
          `FASTQ files not available on ENA for ${accession}`,
          'The run may not be mirrored to ENA yet. Try: biocli sra download ' + accession + ' --method sra-tools');
      }

      if (errors.length > 0) {
        throw new CliError('API_ERROR',
          `Partial download failure for ${accession}: ${errors.join('; ')}`,
          'Some files failed to download. Check network connectivity and retry.');
      }

      return rows;
    }

    // Method 2: sra-tools
    if (!commandExists('prefetch')) {
      throw new CliError('ARGUMENT',
        'sra-tools not found on PATH',
        'Install sra-tools: conda install -c bioconda sra-tools, or use --method ena');
    }

    const rows: { file: string; size: string; status: string }[] = [];

    try {
      // prefetch downloads the .sra file
      console.error(`Downloading ${accession} with prefetch...`);
      execSync(`prefetch ${accession} -O "${outdir}"`, { stdio: 'inherit' });
      rows.push({ file: `${accession}.sra`, size: '', status: 'prefetch done' });

      // fasterq-dump converts .sra to .fastq
      if (commandExists('fasterq-dump')) {
        console.error(`Converting to FASTQ with fasterq-dump...`);
        execSync(`fasterq-dump "${join(outdir, accession)}" -O "${outdir}" --split-files`, { stdio: 'inherit' });
        rows.push({ file: `${accession}*.fastq`, size: '', status: 'fasterq-dump done' });
      } else {
        rows.push({ file: '', size: '', status: 'fasterq-dump not found — .sra file downloaded only' });
      }
    } catch (err) {
      throw new CliError('API_ERROR',
        `sra-tools failed: ${err instanceof Error ? err.message : String(err)}`,
        'Check that sra-tools is correctly configured');
    }

    return rows;
  },
});
