import { afterEach, describe, expect, it } from 'vitest';
import { diagnoseNetworkFailure } from './network-diagnostics.js';

describe('diagnoseNetworkFailure', () => {
  afterEach(() => {
    delete process.env.CODEX_SANDBOX_NETWORK_DISABLED;
  });

  it('classifies sandbox-disabled sessions as environment failures', () => {
    process.env.CODEX_SANDBOX_NETWORK_DISABLED = '1';
    const error = Object.assign(new TypeError('fetch failed'), {
      cause: { code: 'ENOTFOUND' },
    });

    const diagnosis = diagnoseNetworkFailure(error, {
      serviceName: 'Open Targets',
      url: 'https://api.platform.opentargets.org/api/v4/graphql',
    });

    expect(diagnosis.type).toBe('environment');
    expect(diagnosis.hint).toContain('CODEX_SANDBOX_NETWORK_DISABLED=1');
  });

  it('classifies ENOTFOUND as dns outside sandbox-disabled sessions', () => {
    const error = Object.assign(new TypeError('fetch failed'), {
      cause: { code: 'ENOTFOUND' },
    });

    const diagnosis = diagnoseNetworkFailure(error, {
      serviceName: 'cBioPortal',
      url: 'https://www.cbioportal.org/api',
    });

    expect(diagnosis.type).toBe('dns');
    expect(diagnosis.hint).toContain('DNS resolution failed');
  });
});
