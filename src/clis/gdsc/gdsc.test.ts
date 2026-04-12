import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { HttpContext } from '../../types.js';
import { getRegistry } from '../../registry.js';

const {
  createHttpContextForDatabaseMock,
  refreshGdscDatasetMock,
  loadGdscSensitivityIndexMock,
  gdscPathsMock,
} = vi.hoisted(() => ({
  createHttpContextForDatabaseMock: vi.fn(),
  refreshGdscDatasetMock: vi.fn(),
  loadGdscSensitivityIndexMock: vi.fn(),
  gdscPathsMock: vi.fn(),
}));

vi.mock('../../databases/index.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../databases/index.js')>();
  return {
    ...actual,
    createHttpContextForDatabase: createHttpContextForDatabaseMock,
  };
});

vi.mock('../../datasets/gdsc.js', () => ({
  refreshGdscDataset: refreshGdscDatasetMock,
  loadGdscSensitivityIndex: loadGdscSensitivityIndexMock,
  gdscPaths: gdscPathsMock,
}));

import '../../clis/gdsc/prewarm.js';
import '../../clis/gdsc/refresh.js';

describe('gdsc commands', () => {
  beforeEach(() => {
    createHttpContextForDatabaseMock.mockReset();
    refreshGdscDatasetMock.mockReset();
    loadGdscSensitivityIndexMock.mockReset();
    gdscPathsMock.mockReset();

    createHttpContextForDatabaseMock.mockReturnValue({
      databaseId: 'gdsc',
      fetch: async () => { throw new Error('unexpected fetch'); },
      fetchJson: async () => { throw new Error('unexpected fetchJson'); },
      fetchText: async () => { throw new Error('unexpected fetchText'); },
      fetchXml: async () => { throw new Error('unexpected fetchXml'); },
    } as HttpContext);

    refreshGdscDatasetMock.mockResolvedValue({
      release: '8.5',
      fetchedAt: '2026-04-11T00:00:00.000Z',
    });
    loadGdscSensitivityIndexMock.mockResolvedValue({
      drugs: {
        '1032': { compound: { drugName: 'Afatinib' } },
        '1919': { compound: { drugName: 'Osimertinib' } },
      },
    });
    gdscPathsMock.mockReturnValue({
      index: '/tmp/gdsc-index.json',
    });
  });

  it('prewarm uses non-forced refresh and builds the local index', async () => {
    const cmd = getRegistry().get('gdsc/prewarm');
    expect(cmd?.func).toBeTypeOf('function');

    const result = await cmd!.func!({} as HttpContext, {});

    expect(result).toBeNull();
    expect(createHttpContextForDatabaseMock).toHaveBeenCalledWith('gdsc');
    expect(refreshGdscDatasetMock).toHaveBeenCalledWith(expect.any(Object), { force: false });
    expect(loadGdscSensitivityIndexMock).toHaveBeenCalledWith(expect.any(Object));
  });

  it('refresh forces redownload before rebuilding the local index', async () => {
    const cmd = getRegistry().get('gdsc/refresh');
    expect(cmd?.func).toBeTypeOf('function');

    const result = await cmd!.func!({} as HttpContext, {});

    expect(result).toBeNull();
    expect(createHttpContextForDatabaseMock).toHaveBeenCalledWith('gdsc');
    expect(refreshGdscDatasetMock).toHaveBeenCalledWith(expect.any(Object), { force: true });
    expect(loadGdscSensitivityIndexMock).toHaveBeenCalledWith(expect.any(Object));
  });
});

