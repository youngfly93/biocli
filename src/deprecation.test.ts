import { describe, it, expect } from 'vitest';
import { isLegacyInvocation } from './deprecation.js';

describe('isLegacyInvocation', () => {
  it('returns true for plain ncbicli basename', () => {
    expect(isLegacyInvocation('ncbicli')).toBe(true);
  });

  it('returns true for unix install path', () => {
    expect(isLegacyInvocation('/usr/local/bin/ncbicli')).toBe(true);
  });

  it('returns true for Windows .cmd shim path', () => {
    expect(
      isLegacyInvocation('C:\\Users\\foo\\AppData\\Roaming\\npm\\ncbicli.cmd')
    ).toBe(true);
  });

  it('returns true for symlinked dev binary with .js extension', () => {
    expect(isLegacyInvocation('/tmp/ncbicli.js')).toBe(true);
  });

  it('returns false for the canonical biocli name', () => {
    expect(isLegacyInvocation('biocli')).toBe(false);
    expect(isLegacyInvocation('/usr/local/bin/biocli')).toBe(false);
  });

  it('returns false when ncbicli is only a substring', () => {
    expect(isLegacyInvocation('something-ncbicli-other')).toBe(false);
    expect(isLegacyInvocation('/opt/my-ncbicli-fork/bin')).toBe(false);
  });

  it('returns false for undefined or empty argv[1]', () => {
    expect(isLegacyInvocation(undefined)).toBe(false);
    expect(isLegacyInvocation('')).toBe(false);
  });
});
