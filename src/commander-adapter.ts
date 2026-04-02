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
import { type CliCommand, fullName, getRegistry, strategyLabel } from './registry.js';
import { render as renderOutput } from './output.js';
import { executeCommand } from './execution.js';
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
  const positionalArgs: typeof cmd.args = [];
  for (const arg of cmd.args) {
    if (arg.positional) {
      const bracket = arg.required ? `<${arg.name}>` : `[${arg.name}]`;
      subCmd.argument(bracket, arg.help ?? '');
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
    .option('-v, --verbose', 'Debug output', false);

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
      let format = typeof optionsRecord.format === 'string' ? optionsRecord.format : 'table';
      if (verbose) process.env.NCBICLI_VERBOSE = '1';
      if (cmd.deprecated) {
        const message = typeof cmd.deprecated === 'string' ? cmd.deprecated : `${fullName(cmd)} is deprecated.`;
        const replacement = cmd.replacedBy ? ` Use ${cmd.replacedBy} instead.` : '';
        console.error(chalk.yellow(`Deprecated: ${message}${replacement}`));
      }

      const result = await executeCommand(cmd, kwargs, verbose);
      if (result === null || result === undefined) {
        return;
      }

      const resolved = getRegistry().get(fullName(cmd)) ?? cmd;
      if (format === 'table' && resolved.defaultFormat) {
        format = resolved.defaultFormat;
      }

      if (verbose && (!result || (Array.isArray(result) && result.length === 0))) {
        console.error(chalk.yellow('[Verbose] Warning: Command returned an empty result.'));
      }
      renderOutput(result, {
        fmt: format,
        columns: resolved.columns,
        title: `${resolved.site}/${resolved.name}`,
        elapsed: (Date.now() - startTime) / 1000,
        source: fullName(resolved),
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

const ISSUES_URL = 'https://github.com/biocli/ncbicli/issues';

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
