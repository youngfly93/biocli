/**
 * Command execution: validates args, creates HttpContext, runs commands.
 *
 * This is the single entry point for executing any CLI command. It handles:
 * 1. Argument validation and coercion
 * 2. HttpContext creation (replaces browser sessions from opencli)
 * 3. Timeout enforcement
 * 4. Lazy-loading of TS modules from manifest
 * 5. Lifecycle hooks (onBeforeExecute / onAfterExecute)
 */

import {
  type CliCommand,
  type InternalCliCommand,
  type Arg,
  type CommandArgs,
  getRegistry,
  fullName,
} from './registry.js';
import type { HttpContext } from './types.js';
import { pathToFileURL } from 'node:url';
import { executePipeline } from './pipeline/index.js';
import { createHttpContext } from './ncbi-fetch.js';
import {
  AdapterLoadError,
  ArgumentError,
  CommandExecutionError,
  TimeoutError,
  getErrorMessage,
} from './errors.js';
import { emitHook, type HookContext } from './hooks.js';

/** Default command timeout in seconds (used when timeoutSeconds is set). */
const DEFAULT_COMMAND_TIMEOUT = 60;

const _loadedModules = new Set<string>();

// ── Argument coercion & validation ──────────────────────────────────────────

export function coerceAndValidateArgs(cmdArgs: Arg[], kwargs: CommandArgs): CommandArgs {
  const result: CommandArgs = { ...kwargs };

  for (const argDef of cmdArgs) {
    const val = result[argDef.name];

    if (argDef.required && (val === undefined || val === null || val === '')) {
      throw new ArgumentError(
        `Argument "${argDef.name}" is required.`,
        argDef.help ?? `Provide a value for --${argDef.name}`,
      );
    }

    if (val !== undefined && val !== null) {
      if (argDef.type === 'int' || argDef.type === 'number') {
        const num = Number(val);
        if (Number.isNaN(num)) {
          throw new ArgumentError(`Argument "${argDef.name}" must be a valid number. Received: "${val}"`);
        }
        result[argDef.name] = num;
      } else if (argDef.type === 'boolean' || argDef.type === 'bool') {
        if (typeof val === 'string') {
          const lower = val.toLowerCase();
          if (lower === 'true' || lower === '1') result[argDef.name] = true;
          else if (lower === 'false' || lower === '0') result[argDef.name] = false;
          else throw new ArgumentError(`Argument "${argDef.name}" must be a boolean (true/false). Received: "${val}"`);
        } else {
          result[argDef.name] = Boolean(val);
        }
      }

      const coercedVal = result[argDef.name];
      if (argDef.choices && argDef.choices.length > 0) {
        if (!argDef.choices.map(String).includes(String(coercedVal))) {
          throw new ArgumentError(`Argument "${argDef.name}" must be one of: ${argDef.choices.join(', ')}. Received: "${coercedVal}"`);
        }
      }
    } else if (argDef.default !== undefined) {
      result[argDef.name] = argDef.default;
    }
  }
  return result;
}

// ── Command runner ──────────────────────────────────────────────────────────

async function runCommand(
  cmd: CliCommand,
  ctx: HttpContext,
  kwargs: CommandArgs,
  debug: boolean,
): Promise<unknown> {
  const internal = cmd as InternalCliCommand;
  if (internal._lazy && internal._modulePath) {
    const modulePath = internal._modulePath;
    if (!_loadedModules.has(modulePath)) {
      try {
        await import(pathToFileURL(modulePath).href);
        _loadedModules.add(modulePath);
      } catch (err) {
        throw new AdapterLoadError(
          `Failed to load adapter module ${modulePath}: ${getErrorMessage(err)}`,
          'Check that the adapter file exists and has no syntax errors.',
        );
      }
    }

    const updated = getRegistry().get(fullName(cmd));
    if (updated?.func) {
      return updated.func(ctx, kwargs, debug);
    }
    if (updated?.pipeline) {
      return executePipeline(updated.pipeline, ctx, kwargs);
    }
  }

  if (cmd.func) return cmd.func(ctx, kwargs, debug);
  if (cmd.pipeline) return executePipeline(cmd.pipeline, ctx, kwargs);
  throw new CommandExecutionError(
    `Command ${fullName(cmd)} has no func or pipeline`,
    'This is likely a bug in the adapter definition. Please report this issue.',
  );
}

// ── Timeout helper ──────────────────────────────────────────────────────────

async function runWithTimeout<T>(
  promise: Promise<T>,
  timeoutSeconds: number,
  label: string,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new TimeoutError(label, timeoutSeconds)),
      timeoutSeconds * 1000,
    );
    promise
      .then((val) => { clearTimeout(timer); resolve(val); })
      .catch((err) => { clearTimeout(timer); reject(err); });
  });
}

// ── Required env check ──────────────────────────────────────────────────────

function ensureRequiredEnv(cmd: CliCommand): void {
  const missing = (cmd.requiredEnv ?? []).find(({ name }) => {
    const value = process.env[name];
    return value === undefined || value === null || value === '';
  });
  if (!missing) return;

  throw new CommandExecutionError(
    `Command ${fullName(cmd)} requires environment variable ${missing.name}.`,
    missing.help ?? `Set ${missing.name} before running ${fullName(cmd)}.`,
  );
}

// ── Main entry point ────────────────────────────────────────────────────────

export async function executeCommand(
  cmd: CliCommand,
  rawKwargs: CommandArgs,
  debug: boolean = false,
): Promise<unknown> {
  let kwargs: CommandArgs;
  try {
    kwargs = coerceAndValidateArgs(cmd.args, rawKwargs);
  } catch (err) {
    if (err instanceof ArgumentError) throw err;
    throw new ArgumentError(getErrorMessage(err));
  }

  ensureRequiredEnv(cmd);

  const hookCtx: HookContext = {
    command: fullName(cmd),
    args: kwargs,
    startedAt: Date.now(),
  };
  await emitHook('onBeforeExecute', hookCtx);

  let result: unknown;
  try {
    const ctx = createHttpContext();
    const timeout = cmd.timeoutSeconds;
    if (timeout !== undefined && timeout > 0) {
      result = await runWithTimeout(
        runCommand(cmd, ctx, kwargs, debug),
        timeout,
        fullName(cmd),
      );
    } else {
      result = await runCommand(cmd, ctx, kwargs, debug);
    }
  } catch (err) {
    hookCtx.error = err;
    hookCtx.finishedAt = Date.now();
    await emitHook('onAfterExecute', hookCtx);
    throw err;
  }

  hookCtx.finishedAt = Date.now();
  await emitHook('onAfterExecute', hookCtx, result);
  return result;
}
