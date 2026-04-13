import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  validateAllMock,
  runDoctorMock,
  generateCompletionMock,
  getConfigPathMock,
  getRegistryMock,
  getVersionMock,
} = vi.hoisted(() => ({
  validateAllMock: vi.fn(),
  runDoctorMock: vi.fn(),
  generateCompletionMock: vi.fn(),
  getConfigPathMock: vi.fn(),
  getRegistryMock: vi.fn(),
  getVersionMock: vi.fn(),
}));

vi.mock('./validate.js', () => ({
  validateAll: validateAllMock,
}));

vi.mock('./doctor.js', () => ({
  runDoctor: runDoctorMock,
}));

vi.mock('./discovery.js', () => ({
  BUILTIN_CLIS_DIR: '/builtin-clis',
}));

vi.mock('./completion.js', () => ({
  generateCompletion: generateCompletionMock,
}));

vi.mock('./config.js', () => ({
  getConfigPath: getConfigPathMock,
}));

vi.mock('./registry.js', () => ({
  getRegistry: getRegistryMock,
}));

vi.mock('./schema.js', () => ({
  biocliResultSchema: { title: 'BiocliResult' },
  resultWithMetaSchema: { title: 'ResultWithMeta' },
}));

vi.mock('./version.js', () => ({
  getVersion: getVersionMock,
}));

import { formatVerifyJson, formatVerifyText, runVerify } from './verify.js';

describe('runVerify', () => {
  beforeEach(() => {
    validateAllMock.mockReset();
    runDoctorMock.mockReset();
    generateCompletionMock.mockReset();
    getConfigPathMock.mockReset();
    getRegistryMock.mockReset();
    getVersionMock.mockReset();

    validateAllMock.mockReturnValue([]);
    runDoctorMock.mockResolvedValue({
      checks: [{ name: 'config', ok: true }],
      allPassed: true,
    });
    generateCompletionMock.mockReturnValue('complete -F _biocli_completions biocli');
    getConfigPathMock.mockReturnValue('/tmp/.biocli/config.yaml');
    getRegistryMock.mockReturnValue(new Map([['gene/search', { site: 'gene', name: 'search' }]]));
    getVersionMock.mockReturnValue('0.5.0');
  });

  it('runs validate and doctor by default', async () => {
    const result = await runVerify();
    expect(validateAllMock).toHaveBeenCalledWith('/builtin-clis');
    expect(runDoctorMock).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      allPassed: true,
      steps: [
        { step: 'validate', ok: true, detail: 'All YAML adapters valid' },
        { step: 'doctor', ok: true, detail: 'All 1 checks passed' },
      ],
    });
  });

  it('runs smoke checks and reports the failing smoke sub-check', async () => {
    generateCompletionMock.mockReturnValue('bad completion script');

    const result = await runVerify({ smoke: true });

    expect(result.allPassed).toBe(false);
    expect(result.steps[2]).toMatchObject({
      step: 'smoke',
      ok: false,
      detail: expect.stringContaining('completion bash: bad completion'),
    });
  });
});

describe('verify formatters', () => {
  it('formats text summaries with pass/fail totals', () => {
    const text = formatVerifyText({
      allPassed: false,
      steps: [
        { step: 'validate', ok: true, detail: 'ok' },
        { step: 'doctor', ok: false, detail: 'missing api key' },
      ],
    });
    expect(text).toContain('validate');
    expect(text).toContain('doctor');
    expect(text).toContain('1/2 steps passed.');
  });

  it('formats JSON summaries losslessly', () => {
    const json = formatVerifyJson({
      allPassed: true,
      steps: [{ step: 'validate', ok: true, detail: 'ok' }],
    });
    expect(JSON.parse(json)).toEqual({
      allPassed: true,
      steps: [{ step: 'validate', ok: true, detail: 'ok' }],
    });
  });
});
