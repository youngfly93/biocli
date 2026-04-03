import { describe, expect, it } from 'vitest';
import { getRegistry } from '../../registry.js';
import { CliError } from '../../errors.js';
import type { HttpContext } from '../../types.js';
import { buildGeoSupplUrl, parseFileList } from './download.js';
import './download.js';

// ── Pure function tests ─────────────────────────────────────────────────────

describe('buildGeoSupplUrl', () => {
  it('builds correct URL for GSE12345', () => {
    expect(buildGeoSupplUrl('GSE12345')).toBe(
      'https://ftp.ncbi.nlm.nih.gov/geo/series/GSE12nnn/GSE12345/suppl/',
    );
  });

  it('builds correct URL for GSE100550', () => {
    expect(buildGeoSupplUrl('GSE100550')).toBe(
      'https://ftp.ncbi.nlm.nih.gov/geo/series/GSE100nnn/GSE100550/suppl/',
    );
  });
});

describe('parseFileList', () => {
  const SAMPLE_HTML = `
<html><body>
<a href="../">Parent Directory</a>
<a href="GSE12345_RAW.tar">GSE12345_RAW.tar</a>  2024-01-15 10:30  111M
<a href="GSE12345_counts.csv.gz">GSE12345_counts.csv.gz</a>  2024-01-15 10:31  2.5M
<a href="filelist.txt">filelist.txt</a>  2024-01-15 10:30  795
</body></html>`;

  it('parses file names and sizes from HTML listing', () => {
    const files = parseFileList(SAMPLE_HTML);
    expect(files).toHaveLength(3);
    expect(files[0]).toEqual({ name: 'GSE12345_RAW.tar', size: '111M' });
    expect(files[1]).toEqual({ name: 'GSE12345_counts.csv.gz', size: '2.5M' });
    expect(files[2]).toEqual({ name: 'filelist.txt', size: '795' });
  });

  it('skips parent directory link', () => {
    const files = parseFileList(SAMPLE_HTML);
    expect(files.find(f => f.name === '../')).toBeUndefined();
  });

  it('returns empty for HTML with no files', () => {
    expect(parseFileList('<html><body>No files</body></html>')).toEqual([]);
  });
});

// ── Adapter tests ───────────────────────────────────────────────────────────

const MOCK_HTML = `
<a href="GSE99999_matrix.csv.gz">GSE99999_matrix.csv.gz</a>  2024-06-01 12:00  5.2M
<a href="GSE99999_RAW.tar">GSE99999_RAW.tar</a>  2024-06-01 12:00  200M
<a href="filelist.txt">filelist.txt</a>  2024-06-01 12:00  512
`;

function makeCtx(html?: string): HttpContext {
  return {
    databaseId: 'gds',
    fetch: async () => { throw new Error('unexpected'); },
    fetchXml: async () => { throw new Error('unexpected'); },
    fetchJson: async () => { throw new Error('unexpected'); },
    fetchText: async () => html ?? MOCK_HTML,
  };
}

describe('geo/download adapter', () => {
  it('rejects invalid accession', async () => {
    const cmd = getRegistry().get('geo/download');
    await expect(cmd!.func!(makeCtx(), { accession: 'GDS1234', 'list-only': true }))
      .rejects.toThrow(CliError);
  });

  it('list-only returns available files', async () => {
    const cmd = getRegistry().get('geo/download');
    const result = await cmd!.func!(makeCtx(), { accession: 'GSE99999', 'list-only': true }) as any;
    const rows = result.rows ?? result;
    expect(rows).toHaveLength(3);
    expect(rows[0].file).toBe('GSE99999_matrix.csv.gz');
    expect(rows[0].status).toBe('available');
  });

  it('pattern filters files', async () => {
    const cmd = getRegistry().get('geo/download');
    const result = await cmd!.func!(makeCtx(), {
      accession: 'GSE99999', 'list-only': true, pattern: 'matrix',
    }) as any;
    const rows = result.rows ?? result;
    expect(rows).toHaveLength(1);
    expect(rows[0].file).toContain('matrix');
  });

  it('throws NOT_FOUND when no files match pattern', async () => {
    const cmd = getRegistry().get('geo/download');
    await expect(cmd!.func!(makeCtx(), {
      accession: 'GSE99999', 'list-only': true, pattern: 'nonexistent',
    })).rejects.toThrow(CliError);
  });

  it('throws NOT_FOUND on empty directory', async () => {
    const cmd = getRegistry().get('geo/download');
    await expect(cmd!.func!(makeCtx('<html>empty</html>'), {
      accession: 'GSE99999', 'list-only': true,
    })).rejects.toThrow(CliError);
  });
});
