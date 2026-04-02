/**
 * Unified error types for ncbicli.
 *
 * All errors thrown by the framework should extend CliError so that
 * the top-level handler can render consistent, helpful output with
 * emoji-coded severity and actionable hints.
 *
 * ## Exit codes
 *
 * ncbicli follows Unix conventions (sysexits.h) for process exit codes:
 *
 *   0   Success
 *   1   Generic / unexpected error
 *   2   Argument / usage error          (ArgumentError)
 *  66   No input / empty result         (EmptyResultError)
 *  69   Service unavailable             (AdapterLoadError)
 *  75   Temporary failure, retry later  (TimeoutError, RateLimitError)
 *  78   Configuration error             (ConfigError)
 * 130   Interrupted by Ctrl-C
 */

// ── Exit code table ──────────────────────────────────────────────────────────

export const EXIT_CODES = {
  SUCCESS:         0,
  GENERIC_ERROR:   1,
  USAGE_ERROR:     2,   // Bad arguments / command misuse
  EMPTY_RESULT:   66,   // No data / not found           (EX_NOINPUT)
  SERVICE_UNAVAIL:69,   // Adapter load failure           (EX_UNAVAILABLE)
  TEMPFAIL:       75,   // Timeout / rate limit           (EX_TEMPFAIL)
  CONFIG_ERROR:   78,   // Missing / invalid config       (EX_CONFIG)
  INTERRUPTED:   130,   // Ctrl-C / SIGINT
} as const;

export type ExitCode = typeof EXIT_CODES[keyof typeof EXIT_CODES];

// ── Base class ───────────────────────────────────────────────────────────────

export class CliError extends Error {
  /** Machine-readable error code (e.g. 'API_ERROR', 'RATE_LIMITED') */
  readonly code: string;
  /** Human-readable hint on how to fix the problem */
  readonly hint?: string;
  /** Unix process exit code — defaults to 1 (generic error) */
  readonly exitCode: ExitCode;

  constructor(code: string, message: string, hint?: string, exitCode: ExitCode = EXIT_CODES.GENERIC_ERROR) {
    super(message);
    this.name = new.target.name;
    this.code = code;
    this.hint = hint;
    this.exitCode = exitCode;
  }
}

// ── Typed subclasses ─────────────────────────────────────────────────────────

export class CommandExecutionError extends CliError {
  constructor(message: string, hint?: string) {
    super('COMMAND_EXEC', message, hint, EXIT_CODES.GENERIC_ERROR);
  }
}

export class ConfigError extends CliError {
  constructor(message: string, hint?: string) {
    super('CONFIG', message, hint, EXIT_CODES.CONFIG_ERROR);
  }
}

export class TimeoutError extends CliError {
  constructor(label: string, seconds: number, hint?: string) {
    super(
      'TIMEOUT',
      `${label} timed out after ${seconds}s`,
      hint ?? 'Try again later, or increase the timeout if the NCBI server is slow',
      EXIT_CODES.TEMPFAIL,
    );
  }
}

export class ArgumentError extends CliError {
  constructor(message: string, hint?: string) {
    super('ARGUMENT', message, hint, EXIT_CODES.USAGE_ERROR);
  }
}

export class EmptyResultError extends CliError {
  constructor(command: string, hint?: string) {
    super(
      'EMPTY_RESULT',
      `${command} returned no data`,
      hint ?? 'Check your query parameters or try a different search term',
      EXIT_CODES.EMPTY_RESULT,
    );
  }
}

export class AdapterLoadError extends CliError {
  constructor(message: string, hint?: string) {
    super('ADAPTER_LOAD', message, hint, EXIT_CODES.SERVICE_UNAVAIL);
  }
}

export class RateLimitError extends CliError {
  constructor(message?: string, hint?: string) {
    super(
      'RATE_LIMITED',
      message ?? 'NCBI API rate limit exceeded',
      hint ?? 'Add an API key (ncbicli config set api_key YOUR_KEY) to increase the rate limit from 3 to 10 requests/sec',
      EXIT_CODES.TEMPFAIL,
    );
  }
}

export class ApiError extends CliError {
  constructor(message: string, hint?: string) {
    super(
      'API_ERROR',
      message,
      hint ?? 'Check the NCBI API status at https://www.ncbi.nlm.nih.gov/home/develop/',
      EXIT_CODES.GENERIC_ERROR,
    );
  }
}

// ── Utilities ────────────────────────────────────────────────────────────────

/** Extract a human-readable message from an unknown caught value. */
export function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Error code -> emoji mapping for CLI output rendering. */
export const ERROR_ICONS: Record<string, string> = {
  TIMEOUT:       '⏱ ',
  ARGUMENT:      '❌',
  EMPTY_RESULT:  '📭',
  COMMAND_EXEC:  '💥',
  ADAPTER_LOAD:  '📦',
  NETWORK:       '🌐',
  API_ERROR:     '🚫',
  RATE_LIMITED:   '⏳',
  CONFIG:        '⚙️ ',
};
