#!/usr/bin/env node
/**
 * Build-time CLI manifest compiler.
 *
 * Scans all YAML/TS CLI definitions and pre-compiles them into a single
 * manifest.json for instant cold-start registration (no runtime YAML parsing).
 *
 * Usage: npx tsx src/build-manifest.ts
 * Output: dist/cli-manifest.json
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import yaml from 'js-yaml';
import { getErrorMessage } from './errors.js';
import { fullName, getRegistry, type CliCommand, type InternalCliCommand } from './registry.js';
import { type YamlCliDefinition, parseYamlArgs } from './yaml-schema.js';
import { isRecord } from './utils.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLIS_DIR = path.resolve(__dirname, 'clis');
const OUTPUT = path.resolve(__dirname, '..', 'dist', 'cli-manifest.json');

// ── Manifest types ──────────────────────────────────────────────────────────

export interface ManifestEntry {
  site: string;
  name: string;
  aliases?: string[];
  description: string;
  database?: string;
  strategy: string;
  args: Array<{
    name: string;
    type?: string;
    default?: unknown;
    required?: boolean;
    positional?: boolean;
    help?: string;
    choices?: string[];
  }>;
  columns?: string[];
  defaultFormat?: CliCommand['defaultFormat'];
  pipeline?: Record<string, unknown>[];
  timeout?: number;
  requiredEnv?: NonNullable<CliCommand['requiredEnv']>;
  examples?: NonNullable<CliCommand['examples']>;
  deprecated?: boolean | string;
  replacedBy?: string;
  /**
   * Mirrors CliCommand.noContext. MUST be serialized so the lazy-load stub
   * created at runtime by discovery.ts:loadFromManifest carries the same
   * exemption flags as the live command. Without this, post-build the
   * execution layer cannot tell that a snapshot-dataset command should
   * skip HttpContext creation and the response cache.
   */
  noContext?: boolean;
  /** Mirrors CliCommand.noBatch. Prevents batch-splitting of comma-separated positional args. */
  noBatch?: boolean;
  /** 'yaml' or 'ts' — determines how executeCommand loads the handler */
  type: 'yaml' | 'ts';
  /** Relative path from clis/ dir, e.g. 'pubmed/search.yaml' or 'gene/info.js' */
  modulePath?: string;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

const CLI_MODULE_PATTERN = /\bcli\s*\(/;

function toManifestArgs(args: CliCommand['args']): ManifestEntry['args'] {
  return args.map(arg => ({
    name: arg.name,
    type: arg.type ?? 'str',
    default: arg.default,
    required: !!arg.required,
    positional: arg.positional || undefined,
    help: arg.help ?? '',
    choices: arg.choices,
  }));
}

function toTsModulePath(filePath: string, site: string): string {
  const baseName = path.basename(filePath, path.extname(filePath));
  return `${site}/${baseName}.js`;
}

function commandBelongsToFile(cmd: CliCommand, filePath: string): boolean {
  const sourceFile = (cmd as InternalCliCommand)._sourceFile;
  return typeof sourceFile === 'string' && path.resolve(sourceFile) === path.resolve(filePath);
}

function preferCommandsForFile(commands: CliCommand[], filePath: string): CliCommand[] {
  const deduped = [...new Map(commands.map(cmd => [fullName(cmd), cmd] as const)).values()];
  const matched = deduped.filter(cmd => commandBelongsToFile(cmd, filePath));
  return matched.length > 0 ? matched : deduped;
}

function isCliCommandValue(value: unknown, site: string): value is CliCommand {
  return isRecord(value)
    && typeof value.site === 'string'
    && value.site === site
    && typeof value.name === 'string'
    && Array.isArray(value.args);
}

function toManifestEntry(cmd: CliCommand, modulePath: string): ManifestEntry {
  return {
    site: cmd.site,
    name: cmd.name,
    aliases: cmd.aliases,
    description: cmd.description ?? '',
    database: cmd.database,
    strategy: (cmd.strategy ?? 'public').toString().toLowerCase(),
    args: toManifestArgs(cmd.args),
    columns: cmd.columns,
    defaultFormat: cmd.defaultFormat,
    timeout: cmd.timeoutSeconds,
    requiredEnv: cmd.requiredEnv,
    examples: cmd.examples,
    deprecated: cmd.deprecated,
    replacedBy: cmd.replacedBy,
    // Only emit when true so we don't bloat the manifest with `false` for
    // every command. Reader treats undefined and false the same.
    noContext: cmd.noContext === true ? true : undefined,
    noBatch: cmd.noBatch === true ? true : undefined,
    type: 'ts',
    modulePath,
  };
}

// ── YAML scanner ────────────────────────────────────────────────────────────

function scanYaml(filePath: string, site: string): ManifestEntry | null {
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    const def = yaml.load(raw) as YamlCliDefinition | null;
    if (!isRecord(def)) return null;
    const cliDef = def as YamlCliDefinition;

    const strategyStr = cliDef.strategy ?? 'public';
    const strategy = strategyStr.toLowerCase();
    const args = parseYamlArgs(cliDef.args);

    return {
      site: cliDef.site ?? site,
      name: cliDef.name ?? path.basename(filePath, path.extname(filePath)),
      description: cliDef.description ?? '',
      database: cliDef.database,
      strategy,
      aliases: isRecord(cliDef) && Array.isArray((cliDef as Record<string, unknown>).aliases)
        ? ((cliDef as Record<string, unknown>).aliases as unknown[]).filter((value): value is string => typeof value === 'string')
        : undefined,
      args,
      columns: cliDef.columns,
      defaultFormat: cliDef.defaultFormat as CliCommand['defaultFormat'] | undefined,
      pipeline: cliDef.pipeline,
      timeout: cliDef.timeout,
      examples: isRecord(cliDef) && Array.isArray((cliDef as Record<string, unknown>).examples)
        ? ((cliDef as Record<string, unknown>).examples as unknown[])
          .filter((value): value is NonNullable<CliCommand['examples']>[number] =>
            isRecord(value) && typeof value.goal === 'string' && typeof value.command === 'string')
        : undefined,
      deprecated: (cliDef as Record<string, unknown>).deprecated as boolean | string | undefined,
      replacedBy: (cliDef as Record<string, unknown>).replacedBy as string | undefined,
      type: 'yaml',
    };
  } catch (err) {
    process.stderr.write(`Warning: failed to parse ${filePath}: ${getErrorMessage(err)}\n`);
    return null;
  }
}

// ── TS scanner ──────────────────────────────────────────────────────────────

export async function loadTsManifestEntries(
  filePath: string,
  site: string,
  importer: (moduleHref: string) => Promise<unknown> = moduleHref => import(moduleHref),
): Promise<ManifestEntry[]> {
  try {
    const src = fs.readFileSync(filePath, 'utf-8');

    // Helper/test modules should not appear as CLI commands in the manifest.
    if (!CLI_MODULE_PATTERN.test(src)) return [];

    // Snapshot registry keys before the import.
    const before = new Set(getRegistry().keys());

    // Import the module — its top-level cli() calls register commands.
    const moduleExports = await importer(pathToFileURL(filePath).href);

    // Collect newly registered commands.
    const entries: ManifestEntry[] = [];
    const modulePath = toTsModulePath(filePath, site);

    // Strategy 1: Check exports for CliCommand objects.
    if (moduleExports && typeof moduleExports === 'object') {
      const exportedCommands: CliCommand[] = [];
      for (const value of Object.values(moduleExports as Record<string, unknown>)) {
        if (isCliCommandValue(value, site)) {
          exportedCommands.push(value);
        }
      }
      for (const cmd of preferCommandsForFile(exportedCommands, filePath)) {
        entries.push(toManifestEntry(cmd, modulePath));
      }
    }

    // Strategy 2: Check newly registered commands in the registry.
    if (entries.length === 0) {
      const fileOwnedCommands: CliCommand[] = [];
      for (const [key, cmd] of getRegistry()) {
        if (key === fullName(cmd) && cmd.site === site && commandBelongsToFile(cmd, filePath)) {
          fileOwnedCommands.push(cmd);
        }
      }
      for (const cmd of preferCommandsForFile(fileOwnedCommands, filePath)) {
        entries.push(toManifestEntry(cmd, modulePath));
      }
    }

    // Fallback when source-file attribution is unavailable.
    if (entries.length === 0) {
      const newCommands: CliCommand[] = [];
      for (const [key, cmd] of getRegistry()) {
        if (!before.has(key) && key === fullName(cmd) && cmd.site === site) {
          newCommands.push(cmd);
        }
      }
      for (const cmd of preferCommandsForFile(newCommands, filePath)) {
        entries.push(toManifestEntry(cmd, modulePath));
      }
    }

    return entries;
  } catch (err) {
    process.stderr.write(`Warning: failed to load TS adapter ${filePath}: ${getErrorMessage(err)}\n`);
    return [];
  }
}

// ── Main build function ─────────────────────────────────────────────────────

export async function buildManifest(): Promise<void> {
  const manifest: ManifestEntry[] = [];

  // Check that CLIS_DIR exists
  if (!fs.existsSync(CLIS_DIR)) {
    process.stderr.write(`Warning: CLIs directory not found at ${CLIS_DIR}\n`);
    // Write empty manifest
    const outputDir = path.dirname(OUTPUT);
    if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });
    fs.writeFileSync(OUTPUT, JSON.stringify([], null, 2) + '\n', 'utf-8');
    return;
  }

  const siteDirs = fs.readdirSync(CLIS_DIR, { withFileTypes: true })
    .filter(d => d.isDirectory() && !d.name.startsWith('.') && !d.name.startsWith('_'));

  for (const siteDir of siteDirs) {
    const site = siteDir.name;
    const sitePath = path.join(CLIS_DIR, site);
    const files = fs.readdirSync(sitePath);

    for (const file of files) {
      if (file.startsWith('.')) continue; // skip hidden/AppleDouble files
      const filePath = path.join(sitePath, file);

      if (file.endsWith('.yaml') || file.endsWith('.yml')) {
        const entry = scanYaml(filePath, site);
        if (entry) manifest.push(entry);
      } else if (
        (file.endsWith('.js') && !file.endsWith('.d.js')) ||
        (file.endsWith('.ts') && !file.endsWith('.d.ts') && !file.endsWith('.test.ts'))
      ) {
        const entries = await loadTsManifestEntries(filePath, site);
        manifest.push(...entries);
      }
    }
  }

  // Write manifest
  const outputDir = path.dirname(OUTPUT);
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(OUTPUT, JSON.stringify(manifest, null, 2) + '\n', 'utf-8');

  process.stdout.write(`Manifest compiled: ${manifest.length} commands → ${OUTPUT}\n`);
}

// ── Run directly ────────────────────────────────────────────────────────────

// ESM equivalent of if (require.main === module)
const isMain = process.argv[1] &&
  (process.argv[1] === fileURLToPath(import.meta.url) ||
   process.argv[1].endsWith('/build-manifest.js'));

if (isMain) {
  buildManifest().catch((err) => {
    console.error('Manifest build failed:', err);
    process.exit(1);
  });
}
