import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import type { ToolAnnotations } from '@modelcontextprotocol/sdk/types.js';
import * as z from 'zod/v4';
import { executeCommand } from './execution.js';
import { ConfigError } from './errors.js';
import { fullName, getRegistry, type Arg, type CliCommand } from './registry.js';
import { BIOCLI_COMPLETENESS_VALUES, hasResultMeta, type BiocliCompleteness, type BiocliProvenance } from './types.js';
import { getVersion } from './version.js';

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

const MUTATING_COMMANDS = new Set([
  'aggregate/workflow-annotate',
  'aggregate/workflow-prepare',
  'geo/download',
  'sra/download',
  'unimod/install',
  'unimod/refresh',
]);

const MCP_OUTPUT_SCHEMA = {
  command: z.string(),
  resultKind: z.enum(['raw', 'rows', 'biocli_result']),
  data: z.any(),
  meta: z.object({
    biocliVersion: z.string().optional(),
    totalCount: z.number().optional(),
    query: z.string().optional(),
    ids: z.record(z.string(), z.string()).optional(),
    sources: z.array(z.string()).optional(),
    warnings: z.array(z.string()).optional(),
    queriedAt: z.string().optional(),
    organism: z.string().optional(),
    completeness: z.enum(BIOCLI_COMPLETENESS_VALUES).optional(),
    provenance: z.object({
      retrievedAt: z.string(),
      sources: z.array(z.object({
        source: z.string(),
        url: z.string().optional(),
        databaseRelease: z.string().optional(),
        apiVersion: z.string().optional(),
        recordIds: z.array(z.string()).optional(),
        doi: z.string().optional(),
      })),
    }).optional(),
  }).optional(),
};

interface McpConfigEntry {
  command: string;
  args: string[];
}

interface ClaudeDesktopConfig {
  mcpServers?: Record<string, McpConfigEntry>;
}

interface NormalizedMcpResult extends Record<string, unknown> {
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

function buildArgDescription(arg: Arg): string {
  const parts: string[] = [];
  if (arg.help) parts.push(arg.help);
  if (arg.choices?.length) parts.push(`Choices: ${arg.choices.join(', ')}`);
  if (arg.default !== undefined) parts.push(`Default: ${String(arg.default)}`);
  if (arg.positional) parts.push('Positional');
  return parts.join(' ');
}

function buildStringSchema(arg: Arg): z.ZodTypeAny {
  if (arg.choices && arg.choices.length > 0) {
    const tuple = [arg.choices[0], ...arg.choices.slice(1)] as [string, ...string[]];
    return z.enum(tuple);
  }
  return z.string();
}

function buildBooleanSchema(): z.ZodTypeAny {
  return z.union([z.boolean(), z.string()]).transform((value) => {
    if (typeof value === 'boolean') return value;
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true' || normalized === '1') return true;
    if (normalized === 'false' || normalized === '0') return false;
    throw new Error(`Expected boolean, got "${value}"`);
  });
}

function baseSchemaForArg(arg: Arg): z.ZodTypeAny {
  switch (arg.type) {
    case 'int':
      return z.coerce.number().int();
    case 'number':
      return z.coerce.number();
    case 'bool':
    case 'boolean':
      return buildBooleanSchema();
    default:
      return buildStringSchema(arg);
  }
}

function finalizeSchema(arg: Arg, schema: z.ZodTypeAny): z.ZodTypeAny {
  const description = buildArgDescription(arg);
  let finalized = description ? schema.describe(description) : schema;
  if (arg.default !== undefined) {
    finalized = finalized.optional().default(arg.default);
  } else if (!arg.required) {
    finalized = finalized.optional();
  }
  return finalized;
}

function buildInputSchema(args: Arg[]): Record<string, z.ZodTypeAny> {
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const arg of args) {
    shape[arg.name] = finalizeSchema(arg, baseSchemaForArg(arg));
  }
  return shape;
}

function buildToolDescription(cmd: CliCommand): string {
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

function buildToolAnnotations(cmd: CliCommand): ToolAnnotations {
  const isReadOnly = !MUTATING_COMMANDS.has(fullName(cmd));
  return {
    title: fullName(cmd),
    readOnlyHint: isReadOnly,
    destructiveHint: false,
    idempotentHint: isReadOnly,
    openWorldHint: true,
  };
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

function createServer(scope: McpScope): McpServer {
  const server = new McpServer({
    name: 'biocli',
    version: getVersion(),
  });

  for (const cmd of getMcpCommands(scope)) {
    server.registerTool(
      getMcpToolName(cmd),
      {
        title: fullName(cmd),
        description: buildToolDescription(cmd),
        inputSchema: buildInputSchema(cmd.args),
        outputSchema: MCP_OUTPUT_SCHEMA,
        annotations: buildToolAnnotations(cmd),
      },
      async (args) => {
        const result = await executeCommand(cmd, (args ?? {}) as Record<string, unknown>, false);
        const structuredContent = normalizeMcpResult(cmd, result);
        return {
          content: [{ type: 'text', text: JSON.stringify(structuredContent, null, 2) }],
          structuredContent,
        };
      },
    );
  }

  return server;
}

export async function serveMcpServer(scope: McpScope): Promise<void> {
  const server = createServer(scope);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`[biocli] MCP server ready on stdio (${getMcpCommands(scope).length} tools, scope=${scope})`);
}

function defaultClaudeDesktopConfigPath(): string {
  if (process.platform === 'darwin') {
    return join(homedir(), 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json');
  }
  if (process.platform === 'win32') {
    const appData = process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming');
    return join(appData, 'Claude', 'claude_desktop_config.json');
  }
  const configHome = process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config');
  return join(configHome, 'Claude', 'claude_desktop_config.json');
}

function resolveMcpEntrypoint(scope: McpScope): McpConfigEntry {
  const here = dirname(fileURLToPath(import.meta.url));
  const distMain = join(here, 'main.js');
  if (existsSync(distMain)) {
    return {
      command: process.execPath,
      args: [distMain, 'mcp', 'serve', '--scope', scope],
    };
  }

  const srcMain = join(here, 'main.ts');
  const tsxCli = join(here, '..', 'node_modules', 'tsx', 'dist', 'cli.mjs');
  if (existsSync(srcMain) && existsSync(tsxCli)) {
    return {
      command: process.execPath,
      args: [tsxCli, srcMain, 'mcp', 'serve', '--scope', scope],
    };
  }

  throw new ConfigError(
    'Could not resolve a runnable biocli entrypoint for MCP install.',
    'Run npm run build first, or install biocli from a built package.',
  );
}

export function mergeMcpServerConfig(
  existing: ClaudeDesktopConfig,
  serverName: string,
  entry: McpConfigEntry,
): ClaudeDesktopConfig {
  return {
    ...existing,
    mcpServers: {
      ...(existing.mcpServers ?? {}),
      [serverName]: entry,
    },
  };
}

export function readClaudeDesktopConfig(pathname: string): ClaudeDesktopConfig {
  if (!existsSync(pathname)) return {};
  try {
    const parsed = JSON.parse(readFileSync(pathname, 'utf8')) as ClaudeDesktopConfig;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
  } catch (error) {
    throw new ConfigError(
      `Failed to parse Claude Desktop config at ${pathname}: ${error instanceof Error ? error.message : String(error)}`,
      'Fix the JSON file or use --path to target a clean config file.',
    );
  }
  throw new ConfigError(`Claude Desktop config at ${pathname} is not a JSON object.`);
}

export function installMcpServer(opts: {
  path?: string;
  serverName: string;
  scope: McpScope;
  dryRun?: boolean;
}): { configPath: string; entry: McpConfigEntry; overwritten: boolean } {
  const configPath = opts.path ?? defaultClaudeDesktopConfigPath();
  const existing = readClaudeDesktopConfig(configPath);
  const entry = resolveMcpEntrypoint(opts.scope);
  const overwritten = !!existing.mcpServers?.[opts.serverName];
  const merged = mergeMcpServerConfig(existing, opts.serverName, entry);

  if (!opts.dryRun) {
    mkdirSync(dirname(configPath), { recursive: true });
    writeFileSync(configPath, JSON.stringify(merged, null, 2) + '\n', 'utf8');
  }

  return { configPath, entry, overwritten };
}
