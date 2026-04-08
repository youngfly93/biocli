import { describe, expect, it } from 'vitest';
import { validatePxd, isPrideHosted, repoBrowserUrl, PXD_REGEX } from './proteomics.js';
import { ArgumentError } from '../../errors.js';

describe('PXD_REGEX', () => {
  it('accepts 6-digit PXD', () => {
    expect(PXD_REGEX.test('PXD000001')).toBe(true);
  });
  it('accepts 7-digit PXD', () => {
    expect(PXD_REGEX.test('PXD1234567')).toBe(true);
  });
  it('is case-insensitive on the prefix', () => {
    expect(PXD_REGEX.test('pxd000001')).toBe(true);
    expect(PXD_REGEX.test('Pxd000001')).toBe(true);
  });
  it('rejects <6 digits', () => {
    expect(PXD_REGEX.test('PXD0')).toBe(false);
    expect(PXD_REGEX.test('PXD12345')).toBe(false);
  });
  it('rejects >7 digits', () => {
    expect(PXD_REGEX.test('PXD12345678')).toBe(false);
  });
  it('rejects non-PXD prefixes', () => {
    expect(PXD_REGEX.test('MSV000079514')).toBe(false);
    expect(PXD_REGEX.test('IPX0001234')).toBe(false);
    expect(PXD_REGEX.test('JPST000123')).toBe(false);
  });
});

describe('validatePxd', () => {
  it('returns uppercase canonical form for valid inputs', () => {
    expect(validatePxd('PXD000001')).toBe('PXD000001');
    expect(validatePxd('pxd000001')).toBe('PXD000001');
    expect(validatePxd('  PXD000001  ')).toBe('PXD000001');
  });

  it('throws ArgumentError for invalid inputs', () => {
    expect(() => validatePxd('PXD0')).toThrow(ArgumentError);
    expect(() => validatePxd('not a pxd')).toThrow(ArgumentError);
    expect(() => validatePxd('')).toThrow(ArgumentError);
  });

  it('gives MassIVE-specific hint for MSV ids', () => {
    try {
      validatePxd('MSV000079514');
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(ArgumentError);
      expect((err as ArgumentError).hint).toContain('MassIVE');
    }
  });

  it('gives iProX-specific hint for IPX ids', () => {
    try {
      validatePxd('IPX0001234');
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(ArgumentError);
      expect((err as ArgumentError).hint).toContain('iProX');
    }
  });

  it('gives jPOST-specific hint for JPST ids', () => {
    try {
      validatePxd('JPST000123');
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(ArgumentError);
      expect((err as ArgumentError).hint).toContain('jPOST');
    }
  });

  it('gives generic hint for unrecognized formats', () => {
    try {
      validatePxd('random123');
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(ArgumentError);
      expect((err as ArgumentError).hint).toContain('PXD');
    }
  });
});

describe('isPrideHosted', () => {
  it('recognizes PRIDE across casings', () => {
    expect(isPrideHosted('PRIDE')).toBe(true);
    expect(isPrideHosted('pride')).toBe(true);
    expect(isPrideHosted('Pride')).toBe(true);
  });

  it('rejects other repositories', () => {
    expect(isPrideHosted('iProX')).toBe(false);
    expect(isPrideHosted('MassIVE')).toBe(false);
    expect(isPrideHosted('jPOST')).toBe(false);
    expect(isPrideHosted('')).toBe(false);
    expect(isPrideHosted(undefined)).toBe(false);
    expect(isPrideHosted(null)).toBe(false);
  });
});

describe('repoBrowserUrl', () => {
  it('routes PRIDE to EBI', () => {
    expect(repoBrowserUrl('PRIDE', 'PXD000001')).toContain('ebi.ac.uk');
    expect(repoBrowserUrl('pride', 'PXD000001')).toContain('PXD000001');
  });

  it('routes iProX to iprox.cn', () => {
    expect(repoBrowserUrl('iProX', 'PXD076741')).toContain('iprox.cn');
  });

  it('routes MassIVE to UCSD', () => {
    expect(repoBrowserUrl('MassIVE', 'PXD012345')).toContain('massive.ucsd.edu');
  });

  it('routes jPOST to the jPOST repository', () => {
    expect(repoBrowserUrl('jPOST', 'PXD012345')).toContain('jpostdb.org');
  });

  it('falls back to ProteomeCentral for unknown repositories', () => {
    expect(repoBrowserUrl('unknown', 'PXD012345')).toContain('proteomecentral');
    expect(repoBrowserUrl(undefined, 'PXD012345')).toContain('proteomecentral');
  });
});
