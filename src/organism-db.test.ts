/**
 * Tests for organism-db: resolveOrganism should match known organisms
 * and throw on unknown ones (never silently default to human).
 */

import { describe, it, expect } from 'vitest';
import { resolveOrganism, ORGANISM_DB } from './clis/_shared/organism-db.js';

describe('resolveOrganism', () => {
  it('resolves common name', () => {
    const result = resolveOrganism('human');
    expect(result.taxId).toBe(9606);
    expect(result.keggOrg).toBe('hsa');
  });

  it('resolves scientific name (case-insensitive)', () => {
    const result = resolveOrganism('Mus musculus');
    expect(result.taxId).toBe(10090);
    expect(result.keggOrg).toBe('mmu');
  });

  it('resolves taxonomy ID', () => {
    const result = resolveOrganism('7955');
    expect(result.name).toBe('Danio rerio');
  });

  it('resolves KEGG org code', () => {
    const result = resolveOrganism('dme');
    expect(result.name).toBe('Drosophila melanogaster');
  });

  it('throws on unknown organism instead of silently defaulting to human', () => {
    expect(() => resolveOrganism('martian')).toThrow(/Unknown organism/);
    expect(() => resolveOrganism('hoomans')).toThrow(/Unknown organism/);
    expect(() => resolveOrganism('99999')).toThrow(/Unknown organism/);
  });

  it('lists supported organisms in error message', () => {
    try {
      resolveOrganism('unknown');
    } catch (err) {
      expect((err as Error).message).toContain('human');
      expect((err as Error).message).toContain('mouse');
    }
  });
});
