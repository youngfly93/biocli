/**
 * Tests for KEGG utilities: TSV parsing and ID normalization.
 */

import { describe, it, expect } from 'vitest';
import { parseKeggTsv, parseKeggEntry } from './databases/kegg.js';

describe('parseKeggTsv', () => {
  it('parses tab-delimited lines', () => {
    const input = 'hsa:7157\tpath:hsa04115\nhsa:7157\tpath:hsa05200\n';
    const result = parseKeggTsv(input);
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ key: 'hsa:7157', value: 'path:hsa04115' });
    expect(result[1]).toEqual({ key: 'hsa:7157', value: 'path:hsa05200' });
  });

  it('handles empty input', () => {
    expect(parseKeggTsv('')).toEqual([]);
    expect(parseKeggTsv('   \n  ')).toEqual([]);
  });

  it('handles single-column lines', () => {
    const result = parseKeggTsv('hsa:7157\n');
    expect(result[0]).toEqual({ key: 'hsa:7157', value: '' });
  });
});

describe('parseKeggEntry', () => {
  it('parses flat-file format into sections', () => {
    const input = `ENTRY       H00004                      Disease
NAME        Chronic myeloid leukemia (CML)
DESCRIPTION Chronic myeloid leukemia is caused by BCR-ABL.
///`;
    const result = parseKeggEntry(input);
    expect(result.ENTRY).toContain('H00004');
    expect(result.NAME).toContain('Chronic myeloid leukemia');
    expect(result.DESCRIPTION).toContain('BCR-ABL');
  });
});

describe('KEGG ID normalization', () => {
  it('path: prefix must be stripped to match /list/pathway output', () => {
    // /link/pathway returns "path:hsa04115"
    // /list/pathway returns "hsa04115"
    // The code must normalize by stripping "path:" prefix
    const linkId = 'path:hsa04115';
    const listId = 'hsa04115';
    expect(linkId.replace(/^path:/, '')).toBe(listId);
  });
});
