import { describe, expect, it, vi, beforeEach } from 'vitest';
import { getRegistry } from '../../registry.js';
import type { HttpContext } from '../../types.js';

// Mock the dataset loader BEFORE importing the command modules.
const { refreshUnimodMock, loadUnimodMock } = vi.hoisted(() => ({
  refreshUnimodMock: vi.fn(),
  loadUnimodMock: vi.fn(),
}));

vi.mock('../../datasets/unimod.js', async (importOriginal) => {
  const actual = await importOriginal() as Record<string, unknown>;
  return {
    ...actual,
    refreshUnimod: refreshUnimodMock,
    loadUnimod: loadUnimodMock,
  };
});

// Imports AFTER mocking so cli() registrations use the mocked symbols.
import './install.js';
import './refresh.js';

function makeCtx(): HttpContext {
  return {
    databaseId: 'unimod',
    fetch: async () => { throw new Error('should not be called'); },
    fetchXml: async () => { throw new Error('should not be called'); },
    fetchText: async () => { throw new Error('should not be called'); },
    fetchJson: async () => { throw new Error('should not be called'); },
  };
}

const FAKE_META = {
  source: 'https://www.unimod.org/xml/unimod.xml',
  fetchedAt: '2026-04-08T00:00:00.000Z',
  modCount: 1560,
  staleAfterDays: 90,
  sha256: 'aa50802955726f1500000000000000000000000000000000000000000000',
};

describe('unimod/install adapter', () => {
  beforeEach(() => {
    refreshUnimodMock.mockReset();
    refreshUnimodMock.mockResolvedValue(FAKE_META);
  });

  it('registers as unimod/install', () => {
    const cmd = getRegistry().get('unimod/install');
    expect(cmd).toBeDefined();
    expect(cmd?.database).toBe('unimod');
  });

  it('calls refreshUnimod with force:false (no-op if already installed)', async () => {
    const cmd = getRegistry().get('unimod/install');
    const result = await cmd!.func!(makeCtx(), {});
    expect(refreshUnimodMock).toHaveBeenCalledTimes(1);
    expect(refreshUnimodMock).toHaveBeenCalledWith({ force: false });
    expect(result).toBeNull();
  });

  it('propagates install errors', async () => {
    refreshUnimodMock.mockRejectedValue(new Error('Network down'));
    const cmd = getRegistry().get('unimod/install');
    await expect(cmd!.func!(makeCtx(), {})).rejects.toThrow('Network down');
  });
});

describe('unimod/refresh adapter', () => {
  beforeEach(() => {
    refreshUnimodMock.mockReset();
    refreshUnimodMock.mockResolvedValue(FAKE_META);
  });

  it('registers as unimod/refresh', () => {
    const cmd = getRegistry().get('unimod/refresh');
    expect(cmd).toBeDefined();
    expect(cmd?.database).toBe('unimod');
  });

  it('calls refreshUnimod with force:true (always re-downloads)', async () => {
    const cmd = getRegistry().get('unimod/refresh');
    const result = await cmd!.func!(makeCtx(), {});
    expect(refreshUnimodMock).toHaveBeenCalledTimes(1);
    expect(refreshUnimodMock).toHaveBeenCalledWith({ force: true });
    expect(result).toBeNull();
  });
});
