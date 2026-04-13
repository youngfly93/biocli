import { CliError, EXIT_CODES, getErrorMessage } from './errors.js';
import type { BatchFailure } from './batch-runner.js';
import type { BatchFailureRecord } from './batch-types.js';

export function isRetryableError(error: unknown): boolean {
  if (error instanceof CliError) {
    return error.exitCode === EXIT_CODES.TEMPFAIL;
  }
  return false;
}

export function toBatchFailureRecord(
  command: string,
  failure: BatchFailure<unknown>,
  getInput: (item: unknown) => string = (item) => String(item),
): BatchFailureRecord {
  const error = failure.error;
  if (error instanceof CliError) {
    return {
      input: getInput(failure.item),
      index: failure.index,
      command,
      errorCode: error.code,
      message: error.message,
      retryable: isRetryableError(error),
      source: command.split('/')[0],
      attempts: failure.attempts,
      timestamp: new Date().toISOString(),
      hint: error.hint,
      exitCode: error.exitCode,
    };
  }

  return {
    input: getInput(failure.item),
    index: failure.index,
    command,
    errorCode: 'UNKNOWN',
    message: getErrorMessage(error),
    retryable: false,
    source: command.split('/')[0],
    attempts: failure.attempts,
    timestamp: new Date().toISOString(),
    exitCode: EXIT_CODES.GENERIC_ERROR,
  };
}
