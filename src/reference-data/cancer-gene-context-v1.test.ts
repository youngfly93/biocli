import { describe, expect, it } from 'vitest';
import {
  CANCER_GENE_CONTEXT_BY_SYMBOL,
  CANCER_GENE_CONTEXT_ENTRIES,
  CANCER_GENE_CONTEXT_REFERENCE,
} from './cancer-gene-context-v1.js';
import { annotatePartnerContext, CANCER_DRIVER_GENE_IDS } from '../clis/cbioportal/common.js';

describe('cancer gene context reference v1', () => {
  it('has a stable version and unique symbol/Entrez identities', () => {
    expect(CANCER_GENE_CONTEXT_REFERENCE.id).toBe('biocli-cancer-gene-context-v1');
    expect(CANCER_GENE_CONTEXT_ENTRIES).toHaveLength(172);
    expect(new Set(CANCER_GENE_CONTEXT_ENTRIES.map(entry => entry.symbol)).size).toBe(172);
    expect(new Set(CANCER_GENE_CONTEXT_ENTRIES.map(entry => entry.entrezGeneId)).size).toBe(172);
    expect(new Set(CANCER_DRIVER_GENE_IDS).size).toBe(172);
  });

  it.each([
    ['RPS6KA3', 6197],
    ['SMARCD1', 6602],
    ['SMO', 6608],
    ['TERC', 7012],
    ['GMCL1', 64395],
    ['CSMD3', 114788],
    ['LRP1B', 53353],
    ['SMARCAL1', 50485],
    ['MCRS1', 10445],
    ['CCNQ', 92002],
    ['APBB1IP', 54518],
    ['H3C1', 8350],
    ['H4C9', 8294],
    ['ZRANB3', 84083],
  ])('locks the corrected NCBI identity for %s', (symbol, entrezGeneId) => {
    expect(CANCER_GENE_CONTEXT_BY_SYMBOL.get(symbol)?.entrezGeneId).toBe(entrezGeneId);
  });

  it('requires a matching symbol/Entrez pair before applying the compatibility driver label', () => {
    expect(annotatePartnerContext('KRAS', 3845).tag).toBe('known_driver');
    expect(annotatePartnerContext('KRAS', 4018).tag).toBe('other');
    expect(annotatePartnerContext('LPA', 4018).tag).toBe('other');
    expect(annotatePartnerContext('LRP1B', 53353).tag).toBe('tmb_indicator');
  });
});
