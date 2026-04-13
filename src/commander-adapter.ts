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
import { runBatch } from './batch-runner.js';
import { toBatchFailureRecord } from './batch-failures.js';
import { toBatchSuccessRecord } from './batch-output.js';
import { createBatchArtifactSession } from './batch-resume.js';
import { buildCacheKey, getCachedEntry, setCached } from './cache.js';
import { loadConfig } from './config.js';
import { type CliCommand, fullName, getRegistry, strategyLabel } from './registry.js';
import { render as renderOutput } from './output.js';
import { executeCommand } from './execution.js';
import { runWithProgressReporter } from './progress.js';
import { startSpinner } from './spinner.js';
import { hasResultMeta } from './types.js';
import type { BatchCacheSummary, BatchSuccessRecord } from './batch-types.js';
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
  const hasNamedArg = (name: string) => cmd.args.some(arg => !arg.positional && arg.name === name);
  subCmd
    .option('-f, --format <fmt>', 'Output format: table, plain, json, jsonl, yaml, md, csv', 'table')
    .option('-c, --columns <cols>', 'Columns to display (comma-separated, e.g. pmid,title,abstract)')
    .option('-A, --all-columns', 'Show all available columns', false)
    .option('-v, --verbose', 'Debug output', false)
    .option('--input <file>', 'Batch input: file with one ID per line, or - for stdin')
    .option('--input-file <file>', 'Batch input alias for --input')
    .option('--input-format <fmt>', 'Batch input format: text, csv, tsv, jsonl', 'auto')
    .option('--key <field>', 'Column or JSONL field to read in batch mode')
    .option('--concurrency <n>', 'Max in-flight batch items (default: 4)', '4')
    .option('--jsonl', 'Render batch results as JSONL on stdout', false)
    .option('--resume', 'Resume a batch run from an existing outdir checkpoint', false)
    .option('--resume-from <path>', 'Resume a batch run from a prior manifest.json or run directory')
    .option('--fail-fast', 'Stop scheduling new batch items after the first terminal failure', false)
    .option('--max-errors <n>', 'Stop scheduling new batch items after N terminal failures')
    .option('--skip-cached', 'Reuse cached per-item results in aggregate batch runs when available', false)
    .option('--force-refresh', 'Bypass cached per-item results and refresh local datasets when supported', false)
    .option('--no-cache', 'Skip cache and fetch fresh data')
    .option('--retry <n>', 'Retry failed batch items N times (default: 0)', '0');
  if (!hasNamedArg('outdir')) {
    subCmd.option('--outdir <dir>', 'Write batch artifacts to a run directory');
  }

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
      const inputFile = typeof optionsRecord.inputFile === 'string'
        ? optionsRecord.inputFile
        : typeof optionsRecord.input === 'string'
          ? optionsRecord.input
          : undefined;

      // If --input is provided, read file and inject into the primary positional arg.
      // This is required for:
      //   1. multi-entity commands like aggregate/gene-profile (primary arg = genes)
      //   2. aggregate hero workflows like aggregate/drug-target that validate the
      //      primary positional arg before their internal batch parser runs.
      const primaryArgName = positionalArgs[0]?.name;
      const supportsInputInject = Boolean(primaryArgName) && (
        primaryArgName === 'genes' || cmd.database === 'aggregate'
      );
      if (inputFile && supportsInputInject && !kwargs[primaryArgName]) {
        const { parseBatchInput: parseInput } = await import('./batch.js');
        const items = parseInput({
          inputFile,
          inputFormat: typeof optionsRecord.inputFormat === 'string' ? optionsRecord.inputFormat : undefined,
          key: typeof optionsRecord.key === 'string' ? optionsRecord.key : undefined,
        });
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
      const skipBatch = cmd.database === 'aggregate' || cmd.noBatch === true;
      const batchItems = (primaryArg && !skipBatch)
        ? parseBatchInput({
          positionalValue: kwargs[primaryArg.name] as string | undefined,
          inputFile,
          inputFormat: typeof optionsRecord.inputFormat === 'string' ? optionsRecord.inputFormat : undefined,
          key: typeof optionsRecord.key === 'string' ? optionsRecord.key : undefined,
        })
        : null;

      const retryCount = Math.max(0, parseInt(String(optionsRecord.retry ?? '0'), 10) || 0);
      const concurrency = Math.max(1, parseInt(String(optionsRecord.concurrency ?? '4'), 10) || 4);
      const failFast = optionsRecord.failFast === true;
      const maxErrorsRaw = optionsRecord.maxErrors;
      const maxErrors = maxErrorsRaw == null ? undefined : Math.max(1, parseInt(String(maxErrorsRaw), 10) || 1);
      const outdir = typeof optionsRecord.outdir === 'string' ? optionsRecord.outdir : undefined;
      const wantsJsonl = optionsRecord.jsonl === true;
      const resumeFrom = typeof optionsRecord.resumeFrom === 'string' ? optionsRecord.resumeFrom : undefined;
      const resume = optionsRecord.resume === true || Boolean(resumeFrom);
      kwargs.__batch = {
        inputFile,
        inputFormat: typeof optionsRecord.inputFormat === 'string' ? optionsRecord.inputFormat : 'auto',
        key: typeof optionsRecord.key === 'string' ? optionsRecord.key : undefined,
        concurrency,
        outdir,
        jsonl: wantsJsonl,
        resume,
        resumeFrom,
        failFast,
        maxErrors,
        retries: retryCount,
        skipCached: optionsRecord.skipCached === true,
        forceRefresh: optionsRecord.forceRefresh === true,
        noCache,
      };

      let result: unknown;
      if (batchItems && primaryArg) {
        if (resume && !outdir && !resumeFrom) {
          throw new ArgumentError('--resume requires --outdir or --resume-from so completed items can be restored.');
        }
        const databaseId = cmd.database ?? 'ncbi';
        const needsNoContext = databaseId === 'aggregate' || cmd.noContext === true;
        const cacheConfig = loadConfig().cache;
        const cacheEnabled = (cacheConfig?.enabled ?? true) && !noCache && !needsNoContext;
        const cacheTtlMs = (cacheConfig?.ttl ?? 24) * 60 * 60 * 1000;
        const cache: BatchCacheSummary = {
          policy: !cacheEnabled
            ? 'disabled'
            : optionsRecord.forceRefresh === true
              ? 'force-refresh'
              : optionsRecord.skipCached === true
                ? 'skip-cached'
                : 'default',
          hits: 0,
          misses: 0,
          writes: 0,
        };
        const batchStartedAt = new Date().toISOString();
        const spinnerLabel = `Batch ${fullName(cmd)} (${batchItems.length} items)…`;
        const spinner = startSpinner(spinnerLabel);
        try {
          const cacheArgsForInput = (input: string): Record<string, unknown> => {
            const cacheArgs: Record<string, unknown> = {};
            for (const arg of cmd.args) {
              if (arg.positional) {
                if (arg.name === primaryArg.name) {
                  cacheArgs[arg.name] = input;
                }
              } else if (kwargs[arg.name] !== undefined) {
                cacheArgs[arg.name] = kwargs[arg.name];
              }
            }
            return cacheArgs;
          };
          const session = (outdir || resume)
            ? createBatchArtifactSession({
                outdir,
                resume,
                resumeFrom,
                command: fullName(cmd),
              })
            : null;
          const pendingItems = session
            ? session.pendingEntries(batchItems.map((input, index) => ({ input, index })))
            : batchItems.map((input, index) => ({ input, index }));
          if (session && session.skippedCompletedCount > 0) {
            spinner.update(`Resume checkpoint: skipping ${session.skippedCompletedCount} completed item(s)…`);
          }

          const cachedSuccesses: BatchSuccessRecord[] = [];
          const executionItems: Array<{ input: string; index: number }> = [];
          if (cacheEnabled && optionsRecord.forceRefresh !== true) {
            for (const entry of pendingItems) {
              const cacheKey = buildCacheKey(databaseId, fullName(cmd), cacheArgsForInput(entry.input));
              const cached = getCachedEntry(databaseId, fullName(cmd), cacheKey, cacheTtlMs);
              if (cached) {
                const record: BatchSuccessRecord = {
                  input: entry.input,
                  index: entry.index,
                  attempts: 0,
                  succeededAt: new Date().toISOString(),
                  cache: {
                    hit: true,
                    source: 'result-cache',
                    cachedAt: new Date(cached.cachedAt).toISOString(),
                  },
                  result: cached.data,
                };
                cachedSuccesses.push(record);
                session?.recordSuccess(record);
                cache.hits += 1;
              } else {
                executionItems.push(entry);
                cache.misses += 1;
              }
            }
          } else {
            executionItems.push(...pendingItems);
            if (cacheEnabled) cache.misses = executionItems.length;
          }

          if (cachedSuccesses.length > 0) {
            spinner.update(`Batch cache: reusing ${cachedSuccesses.length} cached item(s)…`);
          }

          const batchRun = await runBatch({
            items: executionItems,
            concurrency,
            retries: retryCount,
            failFast,
            maxErrors,
            itemLabel: (entry) => entry.input,
            onProgress: ({ completed, failed, inFlight, total, lastItem }) => {
              const suffix = lastItem ? ` ${lastItem}` : '';
              spinner.update(`Batch ${fullName(cmd)} ${completed + cache.hits}/${batchItems.length} done, ${failed} failed, ${inFlight} running…${suffix}`);
            },
            onSuccess: async (entry) => {
              const cacheKey = cacheEnabled
                ? buildCacheKey(databaseId, fullName(cmd), cacheArgsForInput(entry.item.input))
                : null;
              if (cacheEnabled && cacheKey) {
                try {
                  setCached(databaseId, fullName(cmd), cacheKey, entry.result, cacheTtlMs);
                  cache.writes += 1;
                } catch {
                  // Non-fatal: batch output should still complete even if the shared cache directory is unavailable.
                }
              }
              const record = toBatchSuccessRecord({
                ...entry,
                item: entry.item.input,
                index: entry.item.index,
              });
              if (!session) return;
              session.recordSuccess(record);
            },
            onFailure: async (entry) => {
              if (!session) return;
              session.recordFailure({
                ...toBatchFailureRecord(fullName(cmd), entry, item => (item as { input: string }).input),
                index: entry.item.index,
              });
            },
            executor: async (entry) => {
              const batchKwargs = { ...kwargs, [primaryArg.name]: entry.input };
              return runWithProgressReporter(
                (message) => spinner.update(message),
                () => executeCommand(cmd, batchKwargs, verbose, { noCache: true }),
              );
            },
          });

          const batchFinishedAt = new Date().toISOString();
          const directSuccesses = [
            ...cachedSuccesses,
            ...batchRun.successes.map((entry) => toBatchSuccessRecord({
              ...entry,
              item: entry.item.input,
              index: entry.item.index,
            })),
          ].sort((a, b) => a.index - b.index || a.input.localeCompare(b.input));
          const directFailures = batchRun.failures
            .map((entry) => ({
              ...toBatchFailureRecord(fullName(cmd), entry, item => (item as { input: string }).input),
              index: entry.item.index,
            }))
            .sort((a, b) => a.index - b.index || a.input.localeCompare(b.input));
          const finalized = session
            ? session.finalize({
                command: fullName(cmd),
                totalItems: batchItems.length,
                startedAt: batchStartedAt,
                finishedAt: batchFinishedAt,
                inputSource: inputFile ?? session.previousManifest?.inputSource ?? primaryArg.name,
                inputFormat: typeof optionsRecord.inputFormat === 'string'
                  ? optionsRecord.inputFormat
                  : session.previousManifest?.inputFormat ?? 'auto',
                key: typeof optionsRecord.key === 'string'
                  ? optionsRecord.key
                  : session.previousManifest?.key,
                concurrency,
                retries: retryCount,
                failFast,
                maxErrors,
                cache: cacheEnabled ? cache : undefined,
              })
            : {
                manifest: undefined,
                successes: directSuccesses,
                failures: directFailures,
              };

          const batchResults = finalized.successes
            .map((entry) => entry.result)
            .filter((value) => value !== null && value !== undefined);
          const failedItems = finalized.failures.map((entry) => entry.input);

          if (failedItems.length > 0) {
            console.error(chalk.yellow(`[Batch] ${failedItems.length}/${batchItems.length} failed${retryCount > 0 ? ` (after ${retryCount} retries)` : ''}: ${failedItems.join(', ')}`));
          }
          if (!batchResults.length) {
            console.error(chalk.red(`All ${batchItems.length} batch items failed.`));
            process.exitCode = 1;
            return;
          }
          if (wantsJsonl) format = 'jsonl';
          result = mergeBatchResults(batchResults);
        } finally {
          spinner.stop();
        }
      } else {
        const spinnerLabel = cmd.database
          ? `Querying ${cmd.database}…`
          : `Running ${fullName(cmd)}…`;
        const spinner = startSpinner(spinnerLabel);
        try {
          result = await runWithProgressReporter(
            (message) => spinner.update(message),
            () => executeCommand(cmd, kwargs, verbose, { noCache }),
          );
        } finally {
          spinner.stop();
        }
      }
      if (wantsJsonl) format = 'jsonl';
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
