/**
 * Core registry: Strategy enum, Arg/CliCommand interfaces, cli() registration.
 *
 * Adapted from opencli's registry.ts for NCBI public API access only.
 * No browser, no cookie/header/intercept/UI strategies — just PUBLIC and API_KEY.
 */

import type { HttpContext } from './types.js';
import { fileURLToPath } from 'node:url';

// ── Strategy ─────────────────────────────────────────────────────────────────

export enum Strategy {
  /** No authentication needed — anonymous NCBI E-utilities access. */
  PUBLIC = 'public',
  /** Requires an NCBI API key for higher rate limits or restricted endpoints. */
  API_KEY = 'api_key',
}

// ── Argument & Command types ────────────────────────────────────────────────

export interface Arg {
  name: string;
  type?: string;
  default?: unknown;
  required?: boolean;
  positional?: boolean;
  help?: string;
  choices?: string[];
}

export interface RequiredEnv {
  name: string;
  help?: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- kwargs from CLI parsing are inherently untyped
export type CommandArgs = Record<string, any>;

export interface CliCommand {
  site: string;
  name: string;
  aliases?: string[];
  description: string;
  /** NCBI database this command targets (e.g. 'pubmed', 'gene', 'geo'). */
  database?: string;
  strategy?: Strategy;
  args: Arg[];
  columns?: string[];
  func?: (ctx: HttpContext, kwargs: CommandArgs, debug?: boolean) => Promise<unknown>;
  pipeline?: Record<string, unknown>[];
  timeoutSeconds?: number;
  /** Origin of this command: 'yaml', 'ts', or plugin name. */
  source?: string;
  requiredEnv?: RequiredEnv[];
  /** Deprecation note shown in help / execution warnings. */
  deprecated?: boolean | string;
  /** Preferred replacement command, if any. */
  replacedBy?: string;
  /** Override the default CLI output format when the user does not pass -f/--format. */
  defaultFormat?: 'table' | 'plain' | 'json' | 'yaml' | 'yml' | 'md' | 'markdown' | 'csv';
  /**
   * Mark this command as not needing an HttpContext.
   *
   * Set to `true` for commands that manage their own data source — e.g.
   * "Reference Dataset" snapshot loaders (unimod) or aggregate workflows
   * that build per-database contexts internally.
   *
   * The execution layer will:
   *   1. Skip `createHttpContextForDatabase()` (avoiding the silent NCBI
   *      fallback for unknown database ids), and pass a throw-on-use stub
   *      ctx instead.
   *   2. Skip the response cache layer (these commands manage caching
   *      themselves or are no-ops where caching is meaningless).
   */
  noContext?: boolean;
  /**
   * Disable automatic batch splitting for comma-separated positional arguments.
   *
   * Set to `true` for commands where the positional argument is a
   * comma-separated list that must be passed whole to the handler
   * (e.g. gene-set enrichment, protein-network queries).
   */
  noBatch?: boolean;
}

/** Internal extension for lazy-loaded TS modules (not exposed in public API). */
export interface InternalCliCommand extends CliCommand {
  _lazy?: boolean;
  _modulePath?: string;
  _sourceFile?: string;
}

export interface CliOptions extends Partial<Omit<CliCommand, 'args' | 'description'>> {
  site: string;
  name: string;
  description?: string;
  args?: Arg[];
}

// ── Registry singleton ──────────────────────────────────────────────────────

// Use globalThis to ensure a single shared registry across all module instances.
// This is critical for TS plugins loaded via npm link / peerDependency — without
// this, the plugin's import creates a separate module instance with its own Map.
declare global {
  // eslint-disable-next-line no-var
  var __biocli_registry__: Map<string, CliCommand> | undefined;
  /** @deprecated Alias for __biocli_registry__ — kept for plugin backward compat. */
  // eslint-disable-next-line no-var
  var __ncbicli_registry__: Map<string, CliCommand> | undefined;
}

const _registry: Map<string, CliCommand> =
  globalThis.__biocli_registry__ ??= globalThis.__ncbicli_registry__ ?? new Map<string, CliCommand>();
// Keep legacy alias in sync
globalThis.__ncbicli_registry__ = _registry;

const REGISTRY_MODULE_FILE = fileURLToPath(import.meta.url);

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Register a new CLI command. Returns the created CliCommand object.
 *
 * ```ts
 * export const search = cli({
 *   site: 'pubmed',
 *   name: 'search',
 *   description: 'Search PubMed articles',
 *   database: 'pubmed',
 *   args: [{ name: 'query', positional: true, required: true, help: 'Search query' }],
 *   func: async (ctx, kwargs) => { ... },
 * });
 * ```
 */
export function cli(opts: CliOptions): CliCommand {
  const strategy = opts.strategy ?? Strategy.PUBLIC;
  const aliases = normalizeAliases(opts.aliases, opts.name);
  const cmd: InternalCliCommand = {
    site: opts.site,
    name: opts.name,
    aliases,
    description: opts.description ?? '',
    database: opts.database,
    strategy,
    args: opts.args ?? [],
    columns: opts.columns,
    func: opts.func,
    pipeline: opts.pipeline,
    timeoutSeconds: opts.timeoutSeconds,
    requiredEnv: opts.requiredEnv,
    deprecated: opts.deprecated,
    replacedBy: opts.replacedBy,
    defaultFormat: opts.defaultFormat,
    noContext: opts.noContext,
    noBatch: opts.noBatch,
    _sourceFile: inferCallerFileFromStack(),
  };

  registerCommand(cmd);
  return cmd;
}

/** Return the global command registry map. */
export function getRegistry(): Map<string, CliCommand> {
  return _registry;
}

/** Return the canonical key for a command: "site/name". */
export function fullName(cmd: CliCommand): string {
  return `${cmd.site}/${cmd.name}`;
}

/** Return a human-readable label for the command's access strategy. */
export function strategyLabel(cmd: CliCommand): string {
  return cmd.strategy ?? Strategy.PUBLIC;
}

/** Add a command (and its aliases) to the global registry. */
export function registerCommand(cmd: CliCommand): void {
  const canonicalKey = fullName(cmd);
  const existing = _registry.get(canonicalKey);
  if (existing) {
    // Remove stale alias entries that pointed to the old command object
    for (const [key, value] of _registry.entries()) {
      if (value === existing && key !== canonicalKey) _registry.delete(key);
    }
  }

  const aliases = normalizeAliases(cmd.aliases, cmd.name);
  cmd.aliases = aliases.length > 0 ? aliases : undefined;
  _registry.set(canonicalKey, cmd);
  for (const alias of aliases) {
    _registry.set(`${cmd.site}/${alias}`, cmd);
  }
}

// ── Internal helpers ────────────────────────────────────────────────────────

export function normalizeAliases(aliases: string[] | undefined, commandName: string): string[] {
  if (!Array.isArray(aliases) || aliases.length === 0) return [];

  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const alias of aliases) {
    const value = typeof alias === 'string' ? alias.trim() : '';
    if (!value || value === commandName || seen.has(value)) continue;
    seen.add(value);
    normalized.push(value);
  }
  return normalized;
}

function inferCallerFileFromStack(): string | undefined {
  const stack = new Error().stack?.split('\n') ?? [];
  for (const line of stack.slice(1)) {
    const filePath = parseStackFile(line);
    if (!filePath || filePath === REGISTRY_MODULE_FILE) continue;
    return filePath;
  }
  return undefined;
}

function parseStackFile(line: string): string | undefined {
  const fileUrlMatch = line.match(/(file:\/\/[^\s)]+):\d+:\d+/);
  if (fileUrlMatch) return fileURLToPath(fileUrlMatch[1]);

  const absolutePathMatch = line.match(/((?:\/|[A-Za-z]:\\)[^:\s)]+\.(?:[cm]?js|ts)):\d+:\d+/);
  return absolutePathMatch?.[1];
}
