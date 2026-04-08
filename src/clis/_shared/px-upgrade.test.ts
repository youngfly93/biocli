import { describe, expect, it, vi } from 'vitest';
import type { HttpContext } from '../../types.js';
import { upgradeToPride } from './px-upgrade.js';

function makeCtx(fetchJson: (url: string) => unknown): HttpContext {
  return {
    databaseId: 'mock',
    fetch: async () => { throw new Error('unexpected'); },
    fetchXml: async () => { throw new Error('unexpected'); },
    fetchText: async () => { throw new Error('unexpected'); },
    fetchJson: async (url: string) => fetchJson(url),
  };
}

const HUB_PRIDE = {
  accession: 'PXD000001',
  repository: 'PRIDE',
  title: 'short title from hub',
  species: 'Homo sapiens',
};

const HUB_IPROX = {
  accession: 'PXD076741',
  repository: 'iProX',
  title: 'iProX title',
};

const PRIDE_DETAIL = {
  accession: 'PXD000001',
  title: 'Full PRIDE title with description',
  projectDescription: 'Detailed 272-char description from PRIDE',
  identifiedPTMStrings: [
    { '@type': 'CvParam', name: 'monohydroxylated residue' },
  ],
  submitters: [{ firstName: 'Laurent', lastName: 'Gatto' }],
  instruments: [{ name: 'LTQ Orbitrap Velos' }],
};

describe('upgradeToPride', () => {
  it('returns hub-only status for non-PRIDE repositories (no PRIDE call)', async () => {
    const prideFetch = vi.fn();
    const result = await upgradeToPride(HUB_IPROX, {
      pxCtx: makeCtx(() => { throw new Error('should not be called'); }),
      prideCtx: makeCtx(prideFetch),
    });
    expect(result.status).toBe('hub-only');
    expect(result.warnings).toEqual([]);
    expect(result.record).toBe(HUB_IPROX);
    expect(prideFetch).not.toHaveBeenCalled();
  });

  it('merges PRIDE detail into hub record on success (native status)', async () => {
    const prideFetch = vi.fn().mockImplementation((url: string) => {
      expect(url).toContain('/projects/PXD000001');
      return PRIDE_DETAIL;
    });
    const result = await upgradeToPride(HUB_PRIDE, {
      pxCtx: makeCtx(() => { throw new Error('unexpected'); }),
      prideCtx: makeCtx(prideFetch),
    });
    expect(result.status).toBe('native');
    expect(result.warnings).toEqual([]);
    expect(result.record.title).toBe('Full PRIDE title with description');
    expect(result.record.projectDescription).toContain('272-char');
    expect(result.record.identifiedPTMStrings).toBeDefined();
    expect(result.record.species).toBe('Homo sapiens');
    expect(result.record.repository).toBe('PRIDE');
    expect(prideFetch).toHaveBeenCalledTimes(1);
  });

  it('gracefully degrades to hub-only on PRIDE API failure', async () => {
    const prideFetch = vi.fn().mockRejectedValue(
      new Error('PRIDE returned HTTP 503 after 3 attempts'),
    );
    const result = await upgradeToPride(HUB_PRIDE, {
      pxCtx: makeCtx(() => { throw new Error('unexpected'); }),
      prideCtx: makeCtx(prideFetch),
    });
    expect(result.status).toBe('degraded');
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain('PXD000001');
    expect(result.warnings[0]).toContain('503');
    expect(result.record).toBe(HUB_PRIDE);
  });

  it('handles missing accession on a PRIDE record gracefully', async () => {
    const prideFetch = vi.fn();
    const noAccession = { repository: 'PRIDE', title: 'orphan' } as Record<string, unknown>;
    const result = await upgradeToPride(noAccession, {
      pxCtx: makeCtx(() => { throw new Error('unexpected'); }),
      prideCtx: makeCtx(prideFetch),
    });
    expect(result.status).toBe('degraded');
    expect(result.warnings[0]).toContain('no accession');
    expect(prideFetch).not.toHaveBeenCalled();
  });

  it('treats a missing repository field as non-PRIDE (hub-only)', async () => {
    const prideFetch = vi.fn();
    const noRepo = { accession: 'PXD000001', title: 'no repo field' };
    const result = await upgradeToPride(noRepo, {
      pxCtx: makeCtx(() => { throw new Error('unexpected'); }),
      prideCtx: makeCtx(prideFetch),
    });
    expect(result.status).toBe('hub-only');
    expect(prideFetch).not.toHaveBeenCalled();
  });

  it('is case-insensitive on repository matching', async () => {
    const prideFetch = vi.fn().mockResolvedValue(PRIDE_DETAIL);
    const lowerCase = { ...HUB_PRIDE, repository: 'pride' };
    const result = await upgradeToPride(lowerCase, {
      pxCtx: makeCtx(() => { throw new Error('unexpected'); }),
      prideCtx: makeCtx(prideFetch),
    });
    expect(result.status).toBe('native');
  });
});
