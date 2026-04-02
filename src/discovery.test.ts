/**
 * Tests for discovery: hidden file filtering.
 */

import { describe, it, expect } from 'vitest';

describe('hidden file filtering', () => {
  const shouldSkip = (filename: string) => filename.startsWith('.');

  it('skips AppleDouble ._ files', () => {
    expect(shouldSkip('._info.yaml')).toBe(true);
    expect(shouldSkip('._search.ts')).toBe(true);
  });

  it('skips .DS_Store', () => {
    expect(shouldSkip('.DS_Store')).toBe(true);
  });

  it('skips .gitignore-style hidden files', () => {
    expect(shouldSkip('.hidden')).toBe(true);
  });

  it('does not skip normal files', () => {
    expect(shouldSkip('search.ts')).toBe(false);
    expect(shouldSkip('info.yaml')).toBe(false);
    expect(shouldSkip('gene-profile.ts')).toBe(false);
  });
});
