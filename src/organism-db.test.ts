/**
 * Tests for organism-db: resolveOrganism should match known organisms
 * and throw on unknown ones (never silently default to human).
 */

import { describe, it, expect } from 'vitest';
import { resolveOrganism } from './clis/_shared/organism-db.js';
import { ArgumentError } from './errors.js';

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

  it('throws ArgumentError on unknown organism (not generic Error)', () => {
    expect(() => resolveOrganism('martian')).toThrow(ArgumentError);
    expect(() => resolveOrganism('hoomans')).toThrow(/Unknown organism/);
    expect(() => resolveOrganism('99999')).toThrow(ArgumentError);
  });

  it('provides hint with supported organisms', () => {
    try {
      resolveOrganism('unknown');
    } catch (err) {
      expect(err).toBeInstanceOf(ArgumentError);
      expect((err as ArgumentError).hint).toContain('human');
      expect((err as ArgumentError).hint).toContain('mouse');
    }
  });
});
