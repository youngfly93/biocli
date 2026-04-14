import { ConfigError } from './errors.js';
import { executeCommand } from './execution.js';
import { fullName, getRegistry, type CliCommand } from './registry.js';
import { BIOCLI_COMPLETENESS_VALUES, hasResultMeta, type BiocliCompleteness, type BiocliProvenance } from './types.js';

export const MCP_SCOPE_VALUES = ['hero', 'all'] as const;
export type McpScope = typeof MCP_SCOPE_VALUES[number];

const HERO_COMMANDS = new Set([
  'aggregate/drug-target',
  'aggregate/gene-dossier',
  'aggregate/tumor-gene-dossier',
  'aggregate/variant-dossier',
  'aggregate/literature-brief',
  'aggregate/workflow-prepare',
]);

const AGENT_SUMMARY_COMMANDS = new Set([
  'aggregate/gene-profile',
  'aggregate/drug-target',
  'aggregate/tumor-gene-dossier',
]);

const MUTATING_COMMANDS = new Set([
  'aggregate/workflow-annotate',
  'aggregate/workflow-prepare',
  'geo/download',
  'sra/download',
  'unimod/install',
  'unimod/refresh',
]);

export interface NormalizedMcpResult extends Record<string, unknown> {
  command: string;
  resultKind: 'raw' | 'rows' | 'biocli_result';
  data: unknown;
  meta?: {
    biocliVersion?: string;
    totalCount?: number;
    query?: string;
    ids?: Record<string, string>;
    sources?: string[];
    warnings?: string[];
    queriedAt?: string;
    organism?: string;
    completeness?: BiocliCompleteness;
    provenance?: BiocliProvenance;
  };
}

function isMcpScope(value: string): value is McpScope {
  return (MCP_SCOPE_VALUES as readonly string[]).includes(value);
}

export function parseMcpScope(value: string): McpScope {
  if (!isMcpScope(value)) {
    throw new ConfigError(
      `Unknown MCP scope "${value}".`,
      `Use one of: ${MCP_SCOPE_VALUES.join(', ')}`,
    );
  }
  return value;
}

function uniqueCommands(): CliCommand[] {
  const seen = new Set<CliCommand>();
  const commands: CliCommand[] = [];
  for (const [, cmd] of getRegistry()) {
    if (seen.has(cmd)) continue;
    seen.add(cmd);
    commands.push(cmd);
  }
  return commands.sort((a, b) => fullName(a).localeCompare(fullName(b)));
}

export function getMcpCommands(scope: McpScope): CliCommand[] {
  const commands = uniqueCommands();
  if (scope === 'all') return commands;
  return commands.filter(cmd => HERO_COMMANDS.has(fullName(cmd)));
}

export function getMcpToolName(cmd: CliCommand): string {
  return `${cmd.site}_${cmd.name}`
    .replace(/[^a-zA-Z0-9_]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
}

export function buildMcpToolDescription(cmd: CliCommand): string {
  const commandId = fullName(cmd);
  if (AGENT_SUMMARY_COMMANDS.has(commandId)) {
    const focus = commandId === 'aggregate/drug-target'
      ? 'Use data.agentSummary first for top candidates, matched disease/tumor context, strongest sensitivity signals, warnings, completeness, and recommended next step.'
      : commandId === 'aggregate/tumor-gene-dossier'
        ? 'Use data.agentSummary first for prevalence, top co-mutations, exemplar variants, cohort context, warnings, completeness, and recommended next step.'
        : 'Use data.agentSummary first for top pathways, top interaction partners, top disease links, warnings, completeness, and recommended next step.';
    const pieces = [
      cmd.description,
      focus,
      'The full nested report remains available alongside agentSummary for drill-down.',
    ];
    if (cmd.database) pieces.push(`Database: ${cmd.database}.`);
    if (cmd.args.length > 0) {
      const argSummary = cmd.args
        .map(arg => `${arg.name}${arg.required ? ' (required)' : ''}${arg.help ? `: ${arg.help}` : ''}`)
        .join(' ');
      pieces.push(`Arguments: ${argSummary}`);
    }
    pieces.push(`CLI equivalent: biocli ${cmd.site} ${cmd.name}`);
    return pieces.filter(Boolean).join(' ');
  }

  const pieces = [cmd.description];
  if (cmd.database) pieces.push(`Database: ${cmd.database}.`);
  if (cmd.args.length > 0) {
    const argSummary = cmd.args
      .map(arg => `${arg.name}${arg.required ? ' (required)' : ''}${arg.help ? `: ${arg.help}` : ''}`)
      .join(' ');
    pieces.push(`Arguments: ${argSummary}`);
  }
  pieces.push(`CLI equivalent: biocli ${cmd.site} ${cmd.name}`);
  return pieces.filter(Boolean).join(' ');
}

export function isMcpCommandReadOnly(cmd: CliCommand): boolean {
  return !MUTATING_COMMANDS.has(fullName(cmd));
}

function isStringRecord(value: unknown): value is Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  return Object.values(value).every(item => typeof item === 'string');
}

function toStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.filter((item): item is string => typeof item === 'string');
}

function isCompletenessValue(value: unknown): value is BiocliCompleteness {
  return typeof value === 'string' && (BIOCLI_COMPLETENESS_VALUES as readonly string[]).includes(value);
}

function isBiocliProvenance(value: unknown): value is BiocliProvenance {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const retrievedAt = (value as Record<string, unknown>).retrievedAt;
  const sources = (value as Record<string, unknown>).sources;
  return typeof retrievedAt === 'string' && Array.isArray(sources);
}

export function normalizeMcpResult(cmd: CliCommand, result: unknown): NormalizedMcpResult {
  if (hasResultMeta(result)) {
    return {
      command: fullName(cmd),
      resultKind: 'rows',
      data: result.rows,
      meta: {
        totalCount: result.meta.totalCount,
        query: result.meta.query,
      },
    };
  }

  if (typeof result === 'object' && result !== null && 'data' in result && 'sources' in result) {
    const biocliResult = result as Record<string, unknown>;
    return {
      command: fullName(cmd),
      resultKind: 'biocli_result',
      data: biocliResult.data,
      meta: {
        biocliVersion: typeof biocliResult.biocliVersion === 'string' ? biocliResult.biocliVersion : undefined,
        totalCount: undefined,
        query: typeof biocliResult.query === 'string' ? biocliResult.query : undefined,
        ids: isStringRecord(biocliResult.ids) ? biocliResult.ids : undefined,
        sources: toStringArray(biocliResult.sources),
        warnings: toStringArray(biocliResult.warnings),
        queriedAt: typeof biocliResult.queriedAt === 'string' ? biocliResult.queriedAt : undefined,
        organism: typeof biocliResult.organism === 'string' ? biocliResult.organism : undefined,
        completeness: isCompletenessValue(biocliResult.completeness) ? biocliResult.completeness : undefined,
        provenance: isBiocliProvenance(biocliResult.provenance) ? biocliResult.provenance : undefined,
      },
    };
  }

  return {
    command: fullName(cmd),
    resultKind: 'raw',
    data: result,
  };
}

export async function executeMcpCommand(
  cmd: CliCommand,
  args: Record<string, unknown>,
): Promise<NormalizedMcpResult> {
  const result = await executeCommand(cmd, args, false);
  return normalizeMcpResult(cmd, result);
}
