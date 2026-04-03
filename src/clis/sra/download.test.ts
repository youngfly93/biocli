import { describe, expect, it } from 'vitest';
import { getRegistry } from '../../registry.js';
import { CliError } from '../../errors.js';
import { buildEnaFastqUrls, formatSize, parseMaxSize } from './download.js';
import './download.js';

// ── Pure function tests ─────────────────────────────────────────────────────

describe('buildEnaFastqUrls', () => {
  it('builds URLs without sub-directory for 9-char accession', () => {
    const urls = buildEnaFastqUrls('SRR039885');
    expect(urls[0]).toBe('https://ftp.sra.ebi.ac.uk/vol1/fastq/SRR039/SRR039885/SRR039885.fastq.gz');
    expect(urls[1]).toContain('_1.fastq.gz');
    expect(urls[2]).toContain('_2.fastq.gz');
  });

  it('builds URLs with /00N/ for 10-char accession', () => {
    const urls = buildEnaFastqUrls('SRR1039508');
    expect(urls[0]).toContain('/SRR103/008/SRR1039508/');
  });

  it('builds URLs with /0NN/ for 11-char accession', () => {
    const urls = buildEnaFastqUrls('SRR10395085');
    expect(urls[0]).toContain('/SRR103/085/SRR10395085/');
  });

  it('builds URLs with /NNN/ for 12-char accession', () => {
    const urls = buildEnaFastqUrls('SRR103950856');
    expect(urls[0]).toContain('/SRR103/856/SRR103950856/');
  });

  it('always returns 3 URLs (single-end + paired-end)', () => {
    expect(buildEnaFastqUrls('SRR1234567')).toHaveLength(3);
  });
});

describe('formatSize', () => {
  it('formats bytes', () => {
    expect(formatSize(500)).toBe('500 B');
  });

  it('formats kilobytes', () => {
    expect(formatSize(2048)).toBe('2.0 KB');
  });

  it('formats megabytes', () => {
    expect(formatSize(5 * 1024 * 1024)).toBe('5.0 MB');
  });

  it('formats gigabytes', () => {
    expect(formatSize(1.5 * 1024 * 1024 * 1024)).toBe('1.50 GB');
  });

  it('handles zero', () => {
    expect(formatSize(0)).toBe('unknown size');
  });
});

describe('parseMaxSize', () => {
  it('parses megabytes', () => {
    expect(parseMaxSize('500M')).toBe(500 * 1024 * 1024);
  });

  it('parses gigabytes', () => {
    expect(parseMaxSize('2G')).toBe(2 * 1024 * 1024 * 1024);
  });

  it('parses kilobytes', () => {
    expect(parseMaxSize('1024K')).toBe(1024 * 1024);
  });

  it('parses plain bytes', () => {
    expect(parseMaxSize('1024')).toBe(1024);
  });

  it('returns NaN for invalid input', () => {
    expect(parseMaxSize('abc')).toBeNaN();
  });
});

// ── Adapter: argument validation ────────────────────────────────────────────

describe('sra/download adapter', () => {
  it('rejects invalid accession', async () => {
    const cmd = getRegistry().get('sra/download');
    expect(cmd?.func).toBeTypeOf('function');
    await expect(cmd!.func!({} as any, { accession: 'GSE12345', outdir: '/tmp', method: 'ena' }))
      .rejects.toThrow(CliError);
  });

  it('rejects accession without run prefix', async () => {
    const cmd = getRegistry().get('sra/download');
    await expect(cmd!.func!({} as any, { accession: 'SRP123456', outdir: '/tmp', method: 'ena' }))
      .rejects.toThrow(CliError);
  });
});
