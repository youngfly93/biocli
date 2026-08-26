import { describe, expect, it } from 'vitest';
import { formatCell } from './cell-format.js';
import { toCsv } from './csv.js';

describe('formatCell', () => {
  it('passes primitives through', () => {
    expect(formatCell('EGFR')).toBe('EGFR');
    expect(formatCell(51)).toBe('51');
    expect(formatCell(true)).toBe('true');
  });

  it('renders empty for null and undefined', () => {
    expect(formatCell(null)).toBe('');
    expect(formatCell(undefined)).toBe('');
  });

  it('joins arrays of primitives', () => {
    expect(formatCell(['NCBI Gene', 'UniProt', 'KEGG'])).toBe('NCBI Gene; UniProt; KEGG');
  });

  it('reduces nested records to their most identifying label', () => {
    expect(formatCell([
      { id: 'hsa04010', name: 'MAPK signaling pathway' },
      { id: 'hsa04012', name: 'ErbB signaling pathway' },
    ])).toBe('MAPK signaling pathway; ErbB signaling pathway');
  });

  it('falls back through the label priority order', () => {
    expect(formatCell({ id: 'hsa04010' })).toBe('hsa04010');
    expect(formatCell({ title: 'A variant', accession: 'VCV1' })).toBe('A variant');
    expect(formatCell({ symbol: 'TP53', id: '7157' })).toBe('TP53');
  });

  it('uses the first scalar when no conventional label exists', () => {
    expect(formatCell({ score: 20.5, extra: {} })).toBe('score=20.5');
  });

  it('drops empty entries rather than emitting separators for them', () => {
    expect(formatCell(['NCBI Gene', null, 'KEGG'])).toBe('NCBI Gene; KEGG');
  });

  it('never emits [object Object]', () => {
    const nested = [
      { id: 'hsa04010', name: 'MAPK signaling pathway' },
      { unlabelled: { deep: true } },
    ];
    expect(formatCell(nested)).not.toContain('[object Object]');
  });
});

describe('toCsv', () => {
  it('flattens nested fields instead of stringifying them as [object Object]', () => {
    const csv = toCsv(['symbol', 'pathways'], [{
      symbol: 'EGFR',
      pathways: [
        { id: 'hsa04010', name: 'MAPK signaling pathway' },
        { id: 'hsa04012', name: 'ErbB signaling pathway' },
      ],
    }]);

    expect(csv).not.toContain('[object Object]');
    expect(csv).toContain('MAPK signaling pathway; ErbB signaling pathway');
  });

  it('still quotes cells containing the delimiter', () => {
    const csv = toCsv(['name'], [{ name: 'KRas proto-oncogene, GTPase' }]);
    expect(csv).toContain('"KRas proto-oncogene, GTPase"');
  });
});
