import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { getRegistryMock } = vi.hoisted(() => ({
  getRegistryMock: vi.fn(),
}));

vi.mock('./registry.js', () => ({
  getRegistry: getRegistryMock,
}));

import { generateCompletion, getCompletions, printCompletionScript } from './completion.js';

describe('completion helpers', () => {
  let stdoutSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    getRegistryMock.mockReset();
    getRegistryMock.mockReturnValue(new Map([
      ['gene/search', { site: 'gene', name: 'search', aliases: ['find'] }],
      ['pubmed/fetch', { site: 'pubmed', name: 'fetch' }],
      ['gene/info', { site: 'gene', name: 'info' }],
    ]));
    process.exitCode = undefined;
    stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    stdoutSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it('returns built-ins and sites for first-argument completion', () => {
    expect(getCompletions([], 1)).toEqual([
      'completion',
      'config',
      'gene',
      'list',
      'pubmed',
      'validate',
    ]);
  });

  it('returns config subcommands for built-in config completion', () => {
    expect(getCompletions(['config'], 2)).toEqual(['show', 'set', 'path']);
    expect(getCompletions(['list'], 2)).toEqual([]);
  });

  it('returns site subcommands plus aliases for second-argument completion', () => {
    expect(getCompletions(['gene'], 2)).toEqual(['find', 'info', 'search']);
  });

  it('returns no completions after the subcommand position', () => {
    expect(getCompletions(['gene', 'search'], 3)).toEqual([]);
  });

  it('generates shell-specific completion scripts', () => {
    expect(generateCompletion('bash')).toContain('complete -F _biocli_completions biocli');
    expect(generateCompletion('zsh')).toContain('compdef _biocli biocli');
    expect(generateCompletion('fish')).toContain('complete -c biocli -f');
  });

  it('prints a valid completion script for supported shells', () => {
    printCompletionScript('bash');
    expect(stdoutSpy).toHaveBeenCalledWith(expect.stringContaining('_biocli_completions'));
    expect(process.exitCode).toBeUndefined();
  });

  it('rejects unsupported shells', () => {
    printCompletionScript('powershell');
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Unsupported shell: powershell'));
    expect(process.exitCode).toBe(1);
  });
});
