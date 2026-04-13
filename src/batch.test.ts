import { describe, expect, it } from 'vitest';
import { parseBatchInput, mergeBatchResults } from './batch.js';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('parseBatchInput', () => {
  it('returns null for single value', () => {
    expect(parseBatchInput('TP53', undefined)).toBeNull();
  });

  it('splits comma-separated values', () => {
    expect(parseBatchInput('TP53,BRCA1,EGFR', undefined)).toEqual(['TP53', 'BRCA1', 'EGFR']);
  });

  it('trims whitespace in comma-separated values', () => {
    expect(parseBatchInput('TP53, BRCA1 , EGFR', undefined)).toEqual(['TP53', 'BRCA1', 'EGFR']);
  });

  it('returns null for single comma-value', () => {
    expect(parseBatchInput('TP53', undefined)).toBeNull();
  });

  it('reads from file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'biocli-batch-'));
    const file = join(dir, 'ids.txt');
    writeFileSync(file, 'TP53\nBRCA1\nEGFR\n');
    try {
      expect(parseBatchInput(undefined, file)).toEqual(['TP53', 'BRCA1', 'EGFR']);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('skips comment lines in file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'biocli-batch-'));
    const file = join(dir, 'ids.txt');
    writeFileSync(file, '# Gene list\nTP53\n# Skip\nBRCA1\n');
    try {
      expect(parseBatchInput(undefined, file)).toEqual(['TP53', 'BRCA1']);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('skips empty lines in file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'biocli-batch-'));
    const file = join(dir, 'ids.txt');
    writeFileSync(file, 'TP53\n\n\nBRCA1\n');
    try {
      expect(parseBatchInput(undefined, file)).toEqual(['TP53', 'BRCA1']);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('--input takes priority over positional', () => {
    const dir = mkdtempSync(join(tmpdir(), 'biocli-batch-'));
    const file = join(dir, 'ids.txt');
    writeFileSync(file, 'FROM_FILE\n');
    try {
      expect(parseBatchInput('FROM_POSITIONAL', file)).toEqual(['FROM_FILE']);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('reads from csv using the first column by default', () => {
    const dir = mkdtempSync(join(tmpdir(), 'biocli-batch-'));
    const file = join(dir, 'ids.csv');
    writeFileSync(file, 'gene,label\nTP53,p53\nBRCA1,brca\n');
    try {
      expect(parseBatchInput({ inputFile: file, inputFormat: 'csv' })).toEqual(['TP53', 'BRCA1']);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('reads from csv using a named key', () => {
    const dir = mkdtempSync(join(tmpdir(), 'biocli-batch-'));
    const file = join(dir, 'ids.csv');
    writeFileSync(file, 'gene,label\nTP53,p53\nBRCA1,brca\n');
    try {
      expect(parseBatchInput({ inputFile: file, inputFormat: 'csv', key: 'label' })).toEqual(['p53', 'brca']);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('reads from jsonl using a named key', () => {
    const dir = mkdtempSync(join(tmpdir(), 'biocli-batch-'));
    const file = join(dir, 'ids.jsonl');
    writeFileSync(file, '{"gene":"TP53"}\n{"gene":"BRCA1"}\n');
    try {
      expect(parseBatchInput({ inputFile: file, inputFormat: 'jsonl', key: 'gene' })).toEqual(['TP53', 'BRCA1']);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('mergeBatchResults', () => {
  it('merges plain arrays', () => {
    expect(mergeBatchResults([[{ a: 1 }], [{ a: 2 }]])).toEqual([{ a: 1 }, { a: 2 }]);
  });

  it('merges ResultWithMeta objects', () => {
    const r1 = { rows: [{ a: 1 }], meta: { totalCount: 1 } };
    const r2 = { rows: [{ a: 2 }], meta: { totalCount: 1 } };
    expect(mergeBatchResults([r1, r2])).toEqual([{ a: 1 }, { a: 2 }]);
  });

  it('skips null/undefined results', () => {
    expect(mergeBatchResults([null, [{ a: 1 }], undefined])).toEqual([{ a: 1 }]);
  });
});
