/**
 * Commander adapter: bridges Registry commands to Commander subcommands.
 *
 * This is a THIN adapter — it only handles:
 * 1. Commander arg/option registration
 * 2. Collecting kwargs from Commander's action args
 * 3. Calling executeCommand (which handles HttpContext, validation, etc.)
 * 4. Rendering output and errors
 *
 * All execution logic lives in execution.ts.
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { parseBatchInput, mergeBatchResults } from './batch.js';
import { type CliCommand, fullName, getRegistry, strategyLabel } from './registry.js';
import { render as renderOutput } from './output.js';
import { executeCommand } from './execution.js';
import { startSpinner } from './spinner.js';
import { hasResultMeta } from './types.js';
import {
  CliError,
  EXIT_CODES,
  ERROR_ICONS,
  getErrorMessage,
  ArgumentError,
  AdapterLoadError,
  CommandExecutionError,
  ApiError,
  RateLimitError,
  TimeoutError,
  EmptyResultError,
} from './errors.js';

// ── Arg value normalization ─────────────────────────────────────────────────

export function normalizeArgValue(argType: string | undefined, value: unknown, name: string): unknown {
  if (argType !== 'bool' && argType !== 'boolean') return value;
  if (typeof value === 'boolean') return value;
  if (value == null || value === '') return false;

  const normalized = String(value).trim().toLowerCase();
  if (normalized === 'true') return true;
  if (normalized === 'false') return false;

  throw new ArgumentError(`"${name}" must be either "true" or "false".`);
}

// ── Register a single command ───────────────────────────────────────────────

/**
 * Register a single CliCommand as a Commander subcommand.
 */
export function registerCommandToProgram(siteCmd: Command, cmd: CliCommand): void {
  if (siteCmd.commands.some((c: Command) => c.name() === cmd.name)) return;

  const deprecatedSuffix = cmd.deprecated ? ' [deprecated]' : '';
  const subCmd = siteCmd.command(cmd.name).description(`${cmd.description}${deprecatedSuffix}`);
  if (cmd.aliases?.length) subCmd.aliases(cmd.aliases);

  // Register positional args first, then named options
  // Positional args are always registered as optional with Commander —
  // required checks are done in the action handler to allow --input batch mode
  const positionalArgs: typeof cmd.args = [];
  for (const arg of cmd.args) {
    if (arg.positional) {
      subCmd.argument(`[${arg.name}]`, arg.help ?? '');
      positionalArgs.push(arg);
    } else {
      const flag = arg.required ? `--${arg.name} <value>` : `--${arg.name} [value]`;
      if (arg.required) subCmd.requiredOption(flag, arg.help ?? '');
      else if (arg.default != null) subCmd.option(flag, arg.help ?? '', String(arg.default));
      else subCmd.option(flag, arg.help ?? '');
    }
  }
  subCmd
    .option('-f, --format <fmt>', 'Output format: table, plain, json, yaml, md, csv', 'table')
    .option('-c, --columns <cols>', 'Columns to display (comma-separated, e.g. pmid,title,abstract)')
    .option('-A, --all-columns', 'Show all available columns', false)
    .option('-v, --verbose', 'Debug output', false)
    .option('--input <file>', 'Batch input: file with one ID per line, or - for stdin')
    .option('--no-cache', 'Skip cache and fetch fresh data')
    .option('--retry <n>', 'Retry failed batch items N times (default: 0)', '0');

  subCmd.action(async (...actionArgs: unknown[]) => {
    const actionOpts = actionArgs[positionalArgs.length] ?? {};
    const optionsRecord = typeof actionOpts === 'object' && actionOpts !== null ? actionOpts as Record<string, unknown> : {};
    const startTime = Date.now();

    // ── Execute + render ────────────────────────────────────────────────
    try {
      // ── Collect kwargs ────────────────────────────────────────────────
      const kwargs: Record<string, unknown> = {};
      for (let i = 0; i < positionalArgs.length; i++) {
        const v = actionArgs[i];
        if (v !== undefined) kwargs[positionalArgs[i].name] = v;
      }
      for (const arg of cmd.args) {
        if (arg.positional) continue;
        const camelName = arg.name.replace(/-([a-z])/g, (_m: string, ch: string) => ch.toUpperCase());
        const v = optionsRecord[arg.name] ?? optionsRecord[camelName];
        if (v !== undefined) kwargs[arg.name] = normalizeArgValue(arg.type, v, arg.name);
      }

      const verbose = optionsRecord.verbose === true;
      const inputFile = typeof optionsRecord.input === 'string' ? optionsRecord.input : undefined;

      // If --input is provided, read file and inject into positional arg.
      // Only for commands whose positional arg is named "genes" (multi-entity pattern).
      // Single-entity commands (gene-dossier, variant-dossier, etc.) use batch mode instead.
      const primaryArgName = positionalArgs[0]?.name;
      const supportsInputInject = primaryArgName === 'genes';
      if (inputFile && supportsInputInject && !kwargs[primaryArgName]) {
        const { parseBatchInput: parseInput } = await import('./batch.js');
        const items = parseInput(undefined, inputFile);
        if (items && items.length > 0) {
          kwargs[primaryArgName] = items.join(',');
        }
      }

      // Validate required positional args (unless --input provides batch input)
      if (!inputFile) {
        for (const arg of positionalArgs) {
          if (arg.required && (kwargs[arg.name] === undefined || kwargs[arg.name] === null || kwargs[arg.name] === '')) {
            console.error(chalk.red(`error: missing required argument '${arg.name}'`));
            process.exitCode = 1;
            return;
          }
        }
      }

      let format = typeof optionsRecord.format === 'string' ? optionsRecord.format : 'table';
      if (verbose) process.env.BIOCLI_VERBOSE = '1';
      if (cmd.deprecated) {
        const message = typeof cmd.deprecated === 'string' ? cmd.deprecated : `${fullName(cmd)} is deprecated.`;
        const replacement = cmd.replacedBy ? ` Use ${cmd.replacedBy} instead.` : '';
        console.error(chalk.yellow(`Deprecated: ${message}${replacement}`));
      }

      // Commander's --no-cache sets optionsRecord.cache to false
      const noCache = optionsRecord.cache === false;

      // ── Batch mode: --input or comma-separated positional ────────────
      // Skip batch for aggregate commands — they handle their own multi-input parsing
      const primaryArg = positionalArgs[0]; // first positional = primary ID/query
      const skipBatch = cmd.database === 'aggregate';
      const batchItems = (primaryArg && !skipBatch)
        ? parseBatchInput(kwargs[primaryArg.name] as string | undefined, inputFile)
        : null;

      const retryCount = Math.max(0, parseInt(String(optionsRecord.retry ?? '0'), 10) || 0);

      let result: unknown;
      if (batchItems && primaryArg) {
        const spinnerLabel = `Batch ${fullName(cmd)} (${batchItems.length} items)…`;
        const spinner = startSpinner(spinnerLabel);
        const batchResults: unknown[] = [];
        let failedItems: string[] = [];
        try {
          // First pass
          for (const item of batchItems) {
            try {
              const batchKwargs = { ...kwargs, [primaryArg.name]: item };
              const r = await executeCommand(cmd, batchKwargs, verbose, { noCache });
              if (r !== null && r !== undefined) batchResults.push(r);
            } catch (err) {
              failedItems.push(item);
              if (verbose) console.error(chalk.yellow(`[Batch] ${item} failed: ${err instanceof Error ? err.message : String(err)}`));
            }
          }

          // Retry failed items
          for (let attempt = 1; attempt <= retryCount && failedItems.length > 0; attempt++) {
            if (verbose) console.error(chalk.dim(`[Batch] Retry ${attempt}/${retryCount}: ${failedItems.length} item(s)…`));
            const stillFailed: string[] = [];
            for (const item of failedItems) {
              try {
                const batchKwargs = { ...kwargs, [primaryArg.name]: item };
                const r = await executeCommand(cmd, batchKwargs, verbose, { noCache: true });
                if (r !== null && r !== undefined) batchResults.push(r);
              } catch {
                stillFailed.push(item);
              }
            }
            failedItems = stillFailed;
          }
        } finally {
          spinner.stop();
        }
        if (failedItems.length > 0) {
          console.error(chalk.yellow(`[Batch] ${failedItems.length}/${batchItems.length} failed${retryCount > 0 ? ` (after ${retryCount} retries)` : ''}: ${failedItems.join(', ')}`));
        }
        if (!batchResults.length) {
          console.error(chalk.red(`All ${batchItems.length} batch items failed.`));
          process.exitCode = 1;
          return;
        }
        result = mergeBatchResults(batchResults);
      } else {
        const spinnerLabel = cmd.database
          ? `Querying ${cmd.database}…`
          : `Running ${fullName(cmd)}…`;
        const spinner = startSpinner(spinnerLabel);
        try {
          result = await executeCommand(cmd, kwargs, verbose, { noCache });
        } finally {
          spinner.stop();
        }
      }
      if (result === null || result === undefined) {
        return;
      }

      // Extract display metadata if the command returned ResultWithMeta or BiocliResult
      let biocliResultColumns = false;
      let renderData: unknown = result;
      let totalCount: number | undefined;
      let query: string | undefined;
      let warnings: string[] | undefined;
      if (hasResultMeta(result)) {
        renderData = result.rows;
        totalCount = result.meta.totalCount;
        query = result.meta.query;
      } else if (typeof result === 'object' && result !== null && 'data' in (result as Record<string, unknown>) && 'sources' in (result as Record<string, unknown>)) {
        // BiocliResult envelope — for report/table/csv, render the data payload
        const biocliResult = result as Record<string, unknown>;
        query = String(biocliResult.query ?? '');
        // Surface warnings in ALL formats. For JSON/YAML the envelope already
        // contains `warnings`, so this is a bit redundant — but the stderr
        // rendering gives humans a visible signal alongside the JSON body.
        if (Array.isArray(biocliResult.warnings)) {
          warnings = (biocliResult.warnings as unknown[])
            .filter((w): w is string => typeof w === 'string');
        }
        if (format === 'json' || format === 'yaml' || format === 'yml') {
          // JSON/YAML: render the full envelope (agent-friendly)
          renderData = result;
        } else {
          // table/csv/report/md: render the data payload with actual keys
          renderData = biocliResult.data;
          // Override columns to use data's actual keys (command-declared columns
          // may not match the BiocliResult data payload field names)
          biocliResultColumns = true;
        }
      }

      const resolved = getRegistry().get(fullName(cmd)) ?? cmd;
      if (format === 'table' && resolved.defaultFormat) {
        format = resolved.defaultFormat;
      }

      // Auto-detect pipe: output JSON when stdout is not a terminal
      if (format === 'table' && !process.stdout.isTTY) {
        format = 'json';
      }

      if (verbose && (!renderData || (Array.isArray(renderData) && renderData.length === 0))) {
        console.error(chalk.yellow('[Verbose] Warning: Command returned an empty result.'));
      }

      // Resolve which columns to display:
      //   --columns pmid,title,abstract  →  user-specified subset
      //   --all-columns / -A             →  all keys from first row
      //   (default)                       →  adapter-declared columns
      // For BiocliResult data, use actual keys from the data payload
      let displayColumns: string[] | undefined = biocliResultColumns ? undefined : resolved.columns;
      const allColumns = optionsRecord.allColumns === true || biocliResultColumns;
      const userColumns = typeof optionsRecord.columns === 'string' ? optionsRecord.columns : undefined;

      if (userColumns) {
        displayColumns = userColumns.split(',').map((s: string) => s.trim()).filter(Boolean);
      } else if (allColumns) {
        // Show all fields present in the data
        displayColumns = undefined; // output.ts will derive from row keys
      }

      renderOutput(renderData, {
        fmt: format,
        columns: displayColumns,
        title: `${resolved.site}/${resolved.name}`,
        elapsed: (Date.now() - startTime) / 1000,
        source: fullName(resolved),
        totalCount,
        query,
        warnings,
      });
    } catch (err) {
      renderError(err, fullName(cmd), optionsRecord.verbose === true);
      process.exitCode = resolveExitCode(err);
    }
  });
}

// ── Register all commands ───────────────────────────────────────────────────

/**
 * Iterate the registry, group commands by site, and register each
 * as a Commander subcommand under a site parent command.
 */
export function registerAllCommands(program: Command): void {
  const registry = getRegistry();
  const sites = new Map<string, CliCommand[]>();

  // Deduplicate: skip alias entries (they point to the same CliCommand object)
  const seen = new Set<CliCommand>();
  for (const [, cmd] of registry) {
    if (seen.has(cmd)) continue;
    seen.add(cmd);
    const group = sites.get(cmd.site) ?? [];
    group.push(cmd);
    sites.set(cmd.site, group);
  }

  for (const [site, commands] of sites) {
    // Create parent command for the site (e.g. "pubmed", "gene")
    let siteCmd = program.commands.find(c => c.name() === site);
    if (!siteCmd) {
      siteCmd = program.command(site).description(`${site} commands`);
    }

    for (const cmd of commands) {
      registerCommandToProgram(siteCmd, cmd);
    }
  }
}

// ── Exit code resolution ─────────────────────────────────────────────────────

/**
 * Map any thrown value to a Unix process exit code.
 */
export function resolveExitCode(err: unknown): number {
  if (err instanceof CliError) return err.exitCode;

  const msg = getErrorMessage(err);
  const m = msg.toLowerCase();
  if (/\b(status[: ]+)?[45]\d{2}\b|http[/ ][45]\d{2}/.test(m)) return EXIT_CODES.GENERIC_ERROR;
  if (/not found|no .+ found/.test(m)) return EXIT_CODES.EMPTY_RESULT;
  return EXIT_CODES.GENERIC_ERROR;
}

// ── Error rendering ──────────────────────────────────────────────────────────

const ISSUES_URL = 'https://github.com/youngfly93/biocli/issues';

function renderError(err: unknown, cmdName: string, verbose: boolean): void {
  if (err instanceof CliError) {
    const icon = ERROR_ICONS[err.code] ?? '!';
    console.error(chalk.red(`${icon} ${err.message}`));
    if (err.hint) {
      console.error(chalk.yellow(`  Hint: ${err.hint}`));
    }
    if (verbose && err.stack) {
      console.error(chalk.dim(err.stack));
    }
    return;
  }

  // Generic error
  const message = getErrorMessage(err);
  console.error(chalk.red(`! Error in ${cmdName}: ${message}`));
  if (verbose && err instanceof Error && err.stack) {
    console.error(chalk.dim(err.stack));
  }
  console.error(chalk.dim(`  If this persists, please report at ${ISSUES_URL}`));
}
