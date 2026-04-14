import { describe, expect, it } from 'vitest';
import { buildMcpToolDescription, getMcpToolName, normalizeMcpResult, parseMcpScope } from './mcp-core.js';
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

describe('mcp-core', () => {
  it('parses known MCP scopes', () => {
    expect(parseMcpScope('hero')).toBe('hero');
    expect(parseMcpScope('all')).toBe('all');
  });

  it('normalizes tool names from command ids', () => {
    const cmd = makeCommand({ site: 'aggregate', name: 'gene-dossier' });
    expect(getMcpToolName(cmd)).toBe('aggregate_gene_dossier');
  });

  it('uses summary-first descriptions for hero workflows with agentSummary', () => {
    const cmd = makeCommand({
      site: 'aggregate',
      name: 'drug-target',
      description: 'Target tractability and drug candidate summary from Open Targets',
      database: 'aggregate',
      args: [{ name: 'gene', required: true, help: 'Gene symbol' }] as CliCommand['args'],
    });
    const description = buildMcpToolDescription(cmd);
    expect(description).toContain('Use data.agentSummary first');
    expect(description).toContain('full nested report remains available');
    expect(description).toContain('CLI equivalent: biocli aggregate drug-target');
  });

  it('uses summary-first descriptions for gene-profile now that it has agentSummary', () => {
    const cmd = makeCommand({
      site: 'aggregate',
      name: 'gene-profile',
      description: 'Complete gene profile from NCBI + UniProt + KEGG + STRING',
      database: 'aggregate',
      args: [{ name: 'genes', required: true, help: 'Gene symbol(s)' }] as CliCommand['args'],
    });
    const description = buildMcpToolDescription(cmd);
    expect(description).toContain('Use data.agentSummary first');
    expect(description).toContain('top pathways');
    expect(description).toContain('top interaction partners');
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
});
