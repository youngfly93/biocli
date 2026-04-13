import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  existsSyncMock,
  getRegistryMock,
  renderOutputMock,
  getVersionMock,
  printCompletionScriptMock,
  getCompletionsMock,
  registerAllCommandsMock,
  validateAllMock,
  runDoctorMock,
  formatDoctorTextMock,
  formatDoctorJsonMock,
  getJsonSchemaForTargetMock,
  runVerifyMock,
  formatVerifyTextMock,
  formatVerifyJsonMock,
  loadConfigMock,
  saveConfigMock,
  getConfigPathMock,
  getCacheStatsMock,
  clearCacheMock,
  getWorkflowCatalogMock,
} = vi.hoisted(() => ({
  existsSyncMock: vi.fn(),
  getRegistryMock: vi.fn(),
  renderOutputMock: vi.fn(),
  getVersionMock: vi.fn(),
  printCompletionScriptMock: vi.fn(),
  getCompletionsMock: vi.fn(),
  registerAllCommandsMock: vi.fn(),
  validateAllMock: vi.fn(),
  runDoctorMock: vi.fn(),
  formatDoctorTextMock: vi.fn(),
  formatDoctorJsonMock: vi.fn(),
  getJsonSchemaForTargetMock: vi.fn(),
  runVerifyMock: vi.fn(),
  formatVerifyTextMock: vi.fn(),
  formatVerifyJsonMock: vi.fn(),
  loadConfigMock: vi.fn(),
  saveConfigMock: vi.fn(),
  getConfigPathMock: vi.fn(),
  getCacheStatsMock: vi.fn(),
  clearCacheMock: vi.fn(),
  getWorkflowCatalogMock: vi.fn(),
}));

vi.mock('node:fs', async () => {
  const actual = await vi.importActual<typeof import('node:fs')>('node:fs');
  return {
    ...actual,
    existsSync: existsSyncMock,
  };
});

vi.mock('./registry.js', () => ({
  fullName: (cmd: { site: string; name: string }) => `${cmd.site}/${cmd.name}`,
  strategyLabel: (cmd: { strategy?: string }) => cmd.strategy ?? 'public',
  getRegistry: getRegistryMock,
}));

vi.mock('./output.js', () => ({
  render: renderOutputMock,
}));

vi.mock('./version.js', () => ({
  getVersion: getVersionMock,
}));

vi.mock('./completion.js', () => ({
  printCompletionScript: printCompletionScriptMock,
  getCompletions: getCompletionsMock,
}));

vi.mock('./commander-adapter.js', () => ({
  registerAllCommands: registerAllCommandsMock,
}));

vi.mock('./validate.js', () => ({
  validateAll: validateAllMock,
}));

vi.mock('./doctor.js', () => ({
  runDoctor: runDoctorMock,
  formatDoctorText: formatDoctorTextMock,
  formatDoctorJson: formatDoctorJsonMock,
}));

vi.mock('./schema.js', () => ({
  getJsonSchemaForTarget: getJsonSchemaForTargetMock,
}));

vi.mock('./verify.js', () => ({
  runVerify: runVerifyMock,
  formatVerifyText: formatVerifyTextMock,
  formatVerifyJson: formatVerifyJsonMock,
}));

vi.mock('./config.js', () => ({
  loadConfig: loadConfigMock,
  saveConfig: saveConfigMock,
  getConfigPath: getConfigPathMock,
}));

vi.mock('./cache.js', () => ({
  getStats: getCacheStatsMock,
  clearCache: clearCacheMock,
}));

vi.mock('./discovery.js', () => ({
  BUILTIN_CLIS_DIR: '/builtin-clis',
  USER_CLIS_DIR: '/user-clis',
}));

vi.mock('./workflows.js', () => ({
  getWorkflowCatalog: getWorkflowCatalogMock,
}));

import { runCli } from './cli.js';

describe('runCli built-ins', () => {
  const originalArgv = process.argv.slice();
  let stdoutSpy: ReturnType<typeof vi.spyOn>;
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  async function invokeCli(args: string[]): Promise<void> {
    process.argv = ['node', 'biocli', ...args];
    runCli();
    await new Promise(resolve => setImmediate(resolve));
    await new Promise(resolve => setImmediate(resolve));
  }

  beforeEach(() => {
    process.exitCode = undefined;
    existsSyncMock.mockReset();
    getRegistryMock.mockReset();
    renderOutputMock.mockReset();
    getVersionMock.mockReset();
    printCompletionScriptMock.mockReset();
    getCompletionsMock.mockReset();
    registerAllCommandsMock.mockReset();
    validateAllMock.mockReset();
    runDoctorMock.mockReset();
    formatDoctorTextMock.mockReset();
    formatDoctorJsonMock.mockReset();
    getJsonSchemaForTargetMock.mockReset();
    runVerifyMock.mockReset();
    formatVerifyTextMock.mockReset();
    formatVerifyJsonMock.mockReset();
    loadConfigMock.mockReset();
    saveConfigMock.mockReset();
    getConfigPathMock.mockReset();
    getCacheStatsMock.mockReset();
    clearCacheMock.mockReset();
    getWorkflowCatalogMock.mockReset();

    getVersionMock.mockReturnValue('0.5.0');
    getRegistryMock.mockReturnValue(new Map());
    existsSyncMock.mockReturnValue(false);
    loadConfigMock.mockReturnValue({});
    getConfigPathMock.mockReturnValue('/tmp/.biocli/config.yaml');
    getCacheStatsMock.mockReturnValue({
      totalEntries: 0,
      totalSizeBytes: 0,
      databases: {},
      oldestEntry: null,
      newestEntry: null,
    });

    logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    process.argv = originalArgv.slice();
    logSpy.mockRestore();
    errorSpy.mockRestore();
    stdoutSpy.mockRestore();
  });

  it('renders list JSON rows with workflow/download/query tags', async () => {
    const workflowCmd = {
      site: 'aggregate',
      name: 'gene-dossier',
      description: 'workflow',
      database: 'aggregate',
      args: [],
      strategy: 'public',
      aliases: [],
    };
    const downloadCmd = {
      site: 'uniprot',
      name: 'fetch',
      description: 'fetch sequence',
      database: 'uniprot',
      args: [],
      strategy: 'public',
      aliases: ['get'],
    };
    const queryCmd = {
      site: 'gene',
      name: 'search',
      description: 'search genes',
      database: 'gene',
      args: [],
      strategy: 'api_key',
      aliases: [],
    };
    getRegistryMock.mockReturnValue(new Map([
      ['aggregate/gene-dossier', workflowCmd],
      ['uniprot/fetch', downloadCmd],
      ['gene/search', queryCmd],
      ['gene/find', queryCmd],
    ]));

    await invokeCli(['list', '--format', 'json']);

    expect(renderOutputMock).toHaveBeenCalledTimes(1);
    const [rows, opts] = renderOutputMock.mock.calls[0]!;
    expect(rows).toEqual(expect.arrayContaining([
      expect.objectContaining({ command: 'aggregate/gene-dossier', tags: ['workflow'] }),
      expect.objectContaining({ command: 'uniprot/fetch', tags: ['download'] }),
      expect.objectContaining({ command: 'gene/search', tags: ['query'] }),
    ]));
    expect(rows).toHaveLength(3);
    expect(opts).toMatchObject({ fmt: 'json', title: 'biocli/list' });
  });

  it('validates builtin and user YAML directories and sets exitCode on errors', async () => {
    existsSyncMock.mockImplementation((value: string) => value === '/user-clis');
    validateAllMock.mockImplementation((dir: string) => {
      if (dir === '/builtin-clis') return [];
      return [{ file: '/user-clis/demo/bad.yaml', errors: ['bad pipeline'] }];
    });

    await invokeCli(['validate']);

    expect(validateAllMock).toHaveBeenCalledWith('/builtin-clis');
    expect(validateAllMock).toHaveBeenCalledWith('/user-clis');
    expect(process.exitCode).toBe(1);
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('/user-clis/demo/bad.yaml:'));
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('1 validation error(s) found.'));
  });

  it('reports unknown schema targets as an error', async () => {
    getJsonSchemaForTargetMock.mockReturnValue(null);

    await invokeCli(['schema', 'does/not/exist']);

    expect(process.exitCode).toBe(1);
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Unknown schema target: "does/not/exist".'));
  });

  it('renders workflows through the shared output layer', async () => {
    getWorkflowCatalogMock.mockReturnValue([
      {
        name: 'gene-intelligence-briefing',
        description: 'desc',
        steps: [{ command: 'aggregate/gene-profile', purpose: 'profile' }],
        outputs: ['profile.json'],
      },
    ]);

    await invokeCli(['workflows', '--json']);

    expect(renderOutputMock).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ name: 'gene-intelligence-briefing' })]),
      expect.objectContaining({ fmt: 'json', title: 'biocli/workflows' }),
    );
  });

  it('prints doctor JSON output and marks failures via exitCode', async () => {
    runDoctorMock.mockResolvedValue({ checks: [{ name: 'config', ok: false }], allPassed: false });
    formatDoctorJsonMock.mockReturnValue('{"allPassed":false}');

    await invokeCli(['doctor', '--format', 'json']);

    expect(logSpy).toHaveBeenCalledWith('{"allPassed":false}');
    expect(process.exitCode).toBe(1);
  });

  it('prints verify JSON output and forwards the smoke flag', async () => {
    runVerifyMock.mockResolvedValue({ steps: [], allPassed: false });
    formatVerifyJsonMock.mockReturnValue('{"allPassed":false}');

    await invokeCli(['verify', '--smoke', '--format', 'json']);

    expect(runVerifyMock).toHaveBeenCalledWith({ smoke: true });
    expect(logSpy).toHaveBeenCalledWith('{"allPassed":false}');
    expect(process.exitCode).toBe(1);
  });

  it('handles hidden completion queries without entering normal parse flow', async () => {
    getCompletionsMock.mockReturnValue(['fetch', 'info']);

    await invokeCli(['--get-completions', '--cursor', '2', 'gene']);

    expect(getCompletionsMock).toHaveBeenCalledWith(['gene'], 2);
    expect(stdoutSpy).toHaveBeenCalledWith('fetch\ninfo\n');
  });
});
