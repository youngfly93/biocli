/**
 * Unit tests for all database URL builder functions.
 * These are pure functions with no side effects — ideal for unit testing.
 */

import { describe, expect, it } from 'vitest';
import { buildEutilsUrl, EUTILS_BASE } from './databases/ncbi.js';
import { buildUniprotUrl } from './databases/uniprot.js';
import { buildKeggUrl } from './databases/kegg.js';
import { buildStringUrl, encodeStringIds } from './databases/string-db.js';
import { buildEnsemblUrl } from './databases/ensembl.js';

describe('buildEutilsUrl', () => {
  it('builds correct E-utilities URL with params', () => {
    const url = buildEutilsUrl('esearch.fcgi', { db: 'pubmed', term: 'TP53' });
    expect(url).toContain(`${EUTILS_BASE}/esearch.fcgi`);
    expect(url).toContain('db=pubmed');
    expect(url).toContain('term=TP53');
  });

  it('skips empty param values', () => {
    const url = buildEutilsUrl('esearch.fcgi', { db: 'gene', term: '', retmode: 'json' });
    expect(url).not.toContain('term=');
    expect(url).toContain('retmode=json');
  });
});

describe('buildUniprotUrl', () => {
  it('builds correct UniProt URL', () => {
    const url = buildUniprotUrl('/uniprotkb/P04637', { format: 'json' });
    expect(url).toContain('rest.uniprot.org/uniprotkb/P04637');
    expect(url).toContain('format=json');
  });

  it('works without params', () => {
    const url = buildUniprotUrl('/uniprotkb/search');
    expect(url).toContain('rest.uniprot.org/uniprotkb/search');
  });
});

describe('buildKeggUrl', () => {
  it('builds correct KEGG URL', () => {
    const url = buildKeggUrl('/get/hsa04115');
    expect(url).toBe('https://rest.kegg.jp/get/hsa04115');
  });

  it('builds list endpoint URL', () => {
    const url = buildKeggUrl('/list/pathway/hsa');
    expect(url).toBe('https://rest.kegg.jp/list/pathway/hsa');
  });
});

describe('buildStringUrl', () => {
  it('builds correct STRING URL with caller_identity', () => {
    const url = buildStringUrl('interaction_partners', { identifiers: 'TP53', species: '9606' });
    expect(url).toContain('string-db.org/api/json/interaction_partners');
    expect(url).toContain('identifiers=TP53');
    expect(url).toContain('species=9606');
    expect(url).toContain('caller_identity=biocli');
  });
});

describe('encodeStringIds', () => {
  it('joins IDs with %0d separator', () => {
    expect(encodeStringIds(['TP53', 'BRCA1'])).toBe('TP53%0dBRCA1');
  });

  it('handles single ID', () => {
    expect(encodeStringIds(['TP53'])).toBe('TP53');
  });

  it('handles empty array', () => {
    expect(encodeStringIds([])).toBe('');
  });
});

describe('buildEnsemblUrl', () => {
  it('builds correct Ensembl URL', () => {
    const url = buildEnsemblUrl('/lookup/symbol/homo_sapiens/TP53', { expand: '1' });
    expect(url).toContain('rest.ensembl.org/lookup/symbol/homo_sapiens/TP53');
    expect(url).toContain('expand=1');
  });

  it('works without params', () => {
    const url = buildEnsemblUrl('/info/ping');
    expect(url).toContain('rest.ensembl.org/info/ping');
  });
});
