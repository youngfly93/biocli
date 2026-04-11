#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Command } from 'commander';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import * as z from 'zod/v4';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..');
const DIST_BOOTSTRAP = resolve(ROOT, 'dist/bootstrap.js');
const DIST_MCP_CORE = resolve(ROOT, 'dist/mcp-core.js');
const DIST_VERSION = resolve(ROOT, 'dist/version.js');

if (!existsSync(DIST_BOOTSTRAP) || !existsSync(DIST_MCP_CORE) || !existsSync(DIST_VERSION)) {
  console.error('biocli-mcp requires a built biocli core. Run `npm run build` in the repo root first.');
  process.exit(1);
}

const { initializeBiocli } = await import(DIST_BOOTSTRAP);
const {
  buildMcpToolDescription,
  executeMcpCommand,
  getMcpCommands,
  getMcpToolName,
  isMcpCommandReadOnly,
  parseMcpScope,
} = await import(DIST_MCP_CORE);
const { getVersion } = await import(DIST_VERSION);

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
    completeness: z.string().optional(),
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

function buildStringSchema(arg) {
  if (arg.choices && arg.choices.length > 0) {
    const tuple = [arg.choices[0], ...arg.choices.slice(1)];
    return z.enum(tuple);
  }
  return z.string();
}

function buildBooleanSchema() {
  return z.union([z.boolean(), z.string()]).transform((value) => {
    if (typeof value === 'boolean') return value;
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true' || normalized === '1') return true;
    if (normalized === 'false' || normalized === '0') return false;
    throw new Error(`Expected boolean, got "${value}"`);
  });
}

function buildArgDescription(arg) {
  const parts = [];
  if (arg.help) parts.push(arg.help);
  if (arg.choices?.length) parts.push(`Choices: ${arg.choices.join(', ')}`);
  if (arg.default !== undefined) parts.push(`Default: ${String(arg.default)}`);
  if (arg.positional) parts.push('Positional');
  return parts.join(' ');
}

function baseSchemaForArg(arg) {
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

function finalizeSchema(arg, schema) {
  const description = buildArgDescription(arg);
  let finalized = description ? schema.describe(description) : schema;
  if (arg.default !== undefined) {
    finalized = finalized.optional().default(arg.default);
  } else if (!arg.required) {
    finalized = finalized.optional();
  }
  return finalized;
}

function buildInputSchema(args) {
  const shape = {};
  for (const arg of args) {
    shape[arg.name] = finalizeSchema(arg, baseSchemaForArg(arg));
  }
  return shape;
}

function buildToolAnnotations(cmd) {
  const isReadOnly = isMcpCommandReadOnly(cmd);
  return {
    title: `${cmd.site}/${cmd.name}`,
    readOnlyHint: isReadOnly,
    destructiveHint: false,
    idempotentHint: isReadOnly,
    openWorldHint: true,
  };
}

async function createServer(scope) {
  await initializeBiocli();
  const server = new McpServer({
    name: 'biocli-mcp',
    version: getVersion(),
  });

  for (const cmd of getMcpCommands(scope)) {
    server.registerTool(
      getMcpToolName(cmd),
      {
        title: `${cmd.site}/${cmd.name}`,
        description: buildMcpToolDescription(cmd),
        inputSchema: buildInputSchema(cmd.args),
        outputSchema: MCP_OUTPUT_SCHEMA,
        annotations: buildToolAnnotations(cmd),
      },
      async (args) => {
        const structuredContent = await executeMcpCommand(cmd, args ?? {});
        return {
          content: [{ type: 'text', text: JSON.stringify(structuredContent, null, 2) }],
          structuredContent,
        };
      },
    );
  }

  return server;
}

async function serveMcpServer(scope) {
  const server = await createServer(scope);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`[biocli-mcp] MCP server ready on stdio (${getMcpCommands(scope).length} tools, scope=${scope})`);
}

function defaultClaudeDesktopConfigPath() {
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

function resolveMcpEntrypoint(scope) {
  return {
    command: process.execPath,
    args: [fileURLToPath(import.meta.url), 'serve', '--scope', scope],
  };
}

function readClaudeDesktopConfig(pathname) {
  if (!existsSync(pathname)) return {};
  const parsed = JSON.parse(readFileSync(pathname, 'utf8'));
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
  throw new Error(`Claude Desktop config at ${pathname} is not a JSON object.`);
}

function mergeMcpServerConfig(existing, serverName, entry) {
  return {
    ...existing,
    mcpServers: {
      ...(existing.mcpServers ?? {}),
      [serverName]: entry,
    },
  };
}

function installMcpServer(opts) {
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

const program = new Command();
program
  .name('biocli-mcp')
  .description('Optional MCP companion package for biocli');

program
  .command('serve')
  .description('Start a stdio MCP server for biocli')
  .option('--scope <scope>', 'Tool scope: hero or all', 'hero')
  .action(async (opts) => {
    await serveMcpServer(parseMcpScope(String(opts.scope)));
  });

program
  .command('install')
  .description('Install Claude Desktop MCP config for biocli-mcp')
  .option('--client <client>', 'Target client (currently only claude-desktop)', 'claude-desktop')
  .option('--path <path>', 'Override the target config file path')
  .option('--name <name>', 'Server name in the MCP client config', 'biocli')
  .option('--scope <scope>', 'Tool scope to expose: hero or all', 'hero')
  .option('--dry-run', 'Print the config entry without writing the file', false)
  .action(async (opts) => {
    if (opts.client !== 'claude-desktop') {
      console.error(`Unsupported MCP client: "${opts.client}".`);
      console.error('Currently supported: claude-desktop');
      process.exitCode = 1;
      return;
    }

    const result = installMcpServer({
      path: typeof opts.path === 'string' ? opts.path : undefined,
      serverName: String(opts.name),
      scope: parseMcpScope(String(opts.scope)),
      dryRun: opts.dryRun === true,
    });

    if (opts.dryRun === true) {
      console.log(JSON.stringify({
        mcpServers: {
          [String(opts.name)]: result.entry,
        },
      }, null, 2));
      return;
    }

    const action = result.overwritten ? 'Updated' : 'Installed';
    console.log(`${action} MCP config for "${String(opts.name)}".`);
    console.log(result.configPath);
  });

program.parseAsync(process.argv).catch((error) => {
  console.error(error);
  process.exit(1);
});
