import { describe, expect, it } from 'vitest';
import { mergeMcpServerConfig, getMcpToolName, normalizeMcpResult, parseMcpScope } from './mcp.js';
import type { CliCommand } from './registry.js';
import { withMeta, wrapResult } from './types.js';

function makeCommand(overrides: Partial<CliCommand> = {}): CliCommand {
  return {
    site: 'aggregate',
    name: 'gene-dossier',
    description: 'Test command',
    args: [],
    ...overrides,
  };
}

describe('mcp', () => {
  it('parses known MCP scopes', () => {
    expect(parseMcpScope('hero')).toBe('hero');
    expect(parseMcpScope('all')).toBe('all');
  });

  it('normalizes tool names from command ids', () => {
    const cmd = makeCommand({ site: 'aggregate', name: 'gene-dossier' });
    expect(getMcpToolName(cmd)).toBe('aggregate_gene_dossier');
  });

  it('normalizes ResultWithMeta payloads', () => {
    const cmd = makeCommand({ site: 'pubmed', name: 'search' });
    const result = withMeta([{ pmid: '123' }], { totalCount: 9, query: 'TP53' });
    expect(normalizeMcpResult(cmd, result)).toEqual({
      command: 'pubmed/search',
      resultKind: 'rows',
      data: [{ pmid: '123' }],
      meta: {
        totalCount: 9,
        query: 'TP53',
      },
    });
  });

  it('normalizes BiocliResult payloads', () => {
    const cmd = makeCommand();
    const result = wrapResult(
      { symbol: 'TP53' },
      {
        ids: { ncbiGeneId: '7157' },
        sources: ['NCBI Gene'],
        warnings: ['partial'],
        organism: 'Homo sapiens',
        query: 'TP53',
      },
    );

    expect(normalizeMcpResult(cmd, result)).toEqual({
      command: 'aggregate/gene-dossier',
      resultKind: 'biocli_result',
      data: { symbol: 'TP53' },
      meta: {
        biocliVersion: result.biocliVersion,
        totalCount: undefined,
        query: 'TP53',
        ids: { ncbiGeneId: '7157' },
        sources: ['NCBI Gene'],
        warnings: ['partial'],
        queriedAt: result.queriedAt,
        organism: 'Homo sapiens',
        completeness: 'partial',
        provenance: {
          retrievedAt: result.queriedAt,
          sources: [
            {
              source: 'NCBI Gene',
              url: 'https://www.ncbi.nlm.nih.gov/gene/7157',
              apiVersion: 'E-utilities',
              recordIds: ['7157'],
            },
          ],
        },
      },
    });
  });

  it('merges MCP client config without dropping existing servers', () => {
    expect(mergeMcpServerConfig(
      {
        mcpServers: {
          existing: {
            command: 'node',
            args: ['/tmp/existing.js'],
          },
        },
      },
      'biocli',
      {
        command: 'node',
        args: ['/tmp/biocli.js', 'mcp', 'serve'],
      },
    )).toEqual({
      mcpServers: {
        existing: {
          command: 'node',
          args: ['/tmp/existing.js'],
        },
        biocli: {
          command: 'node',
          args: ['/tmp/biocli.js', 'mcp', 'serve'],
        },
      },
    });
  });
});
