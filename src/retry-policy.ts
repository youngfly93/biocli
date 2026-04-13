import { ApiError, CliError, EXIT_CODES, RateLimitError } from './errors.js';
import { sleep } from './utils.js';

export interface HttpRetryPolicy {
  maxRetries: number;
  baseDelayMs: number;
  backoffFactor: number;
  maxDelayMs: number;
  retryableStatusCodes: number[];
  retryableNetworkCodes: string[];
  retryableErrorNames: string[];
  respectRetryAfter: boolean;
}

export interface HttpRetryPolicyOverrides extends Partial<HttpRetryPolicy> {}

const DEFAULT_HTTP_RETRY_POLICY: HttpRetryPolicy = {
  maxRetries: 2,
  baseDelayMs: 1000,
  backoffFactor: 2,
  maxDelayMs: 10_000,
  retryableStatusCodes: [429, 500, 502, 503, 504],
  retryableNetworkCodes: [
    'UND_ERR_CONNECT_TIMEOUT',
    'ECONNREFUSED',
    'ECONNRESET',
    'ENETUNREACH',
    'ETIMEDOUT',
    'EAI_AGAIN',
    'ENOTFOUND',
  ],
  retryableErrorNames: ['AbortError', 'TypeError'],
  respectRetryAfter: true,
};

const DATABASE_HTTP_RETRY_POLICIES: Record<string, HttpRetryPolicyOverrides> = {
  cbioportal: {
    maxRetries: 2,
    baseDelayMs: 1000,
  },
  enrichr: {
    maxRetries: 2,
    baseDelayMs: 500,
  },
  kegg: {
    maxRetries: 2,
    baseDelayMs: 500,
    retryableStatusCodes: [403, 429],
  },
  ncbi: {
    maxRetries: 3,
    baseDelayMs: 500,
    retryableStatusCodes: [429],
  },
  opentargets: {
    maxRetries: 2,
    baseDelayMs: 1000,
  },
  string: {
    maxRetries: 2,
    baseDelayMs: 1000,
    retryableStatusCodes: [429, 503],
  },
  uniprot: {
    maxRetries: 2,
    baseDelayMs: 500,
    retryableStatusCodes: [429],
  },
};

function clampDelayMs(delayMs: number, maxDelayMs: number): number {
  return Math.max(0, Math.min(maxDelayMs, Math.round(delayMs)));
}

function parseRetryAfterMs(value: string | null | undefined): number | undefined {
  if (!value) return undefined;
  const asSeconds = Number.parseFloat(value);
  if (Number.isFinite(asSeconds) && asSeconds >= 0) {
    return Math.round(asSeconds * 1000);
  }
  const asDate = Date.parse(value);
  if (Number.isNaN(asDate)) return undefined;
  return Math.max(0, asDate - Date.now());
}

function errorCodeOf(error: unknown): string | undefined {
  if (!error || typeof error !== 'object') return undefined;
  if ('code' in error && typeof error.code === 'string') return error.code;
  if ('cause' in error && error.cause && typeof error.cause === 'object' && 'code' in error.cause && typeof error.cause.code === 'string') {
    return error.cause.code;
  }
  return undefined;
}

export function resolveHttpRetryPolicy(
  backendId: string,
  overrides?: HttpRetryPolicyOverrides,
): HttpRetryPolicy {
  const backendDefaults = DATABASE_HTTP_RETRY_POLICIES[backendId] ?? {};
  return {
    ...DEFAULT_HTTP_RETRY_POLICY,
    ...backendDefaults,
    ...overrides,
    retryableStatusCodes: overrides?.retryableStatusCodes ?? backendDefaults.retryableStatusCodes ?? DEFAULT_HTTP_RETRY_POLICY.retryableStatusCodes,
    retryableNetworkCodes: overrides?.retryableNetworkCodes ?? backendDefaults.retryableNetworkCodes ?? DEFAULT_HTTP_RETRY_POLICY.retryableNetworkCodes,
    retryableErrorNames: overrides?.retryableErrorNames ?? backendDefaults.retryableErrorNames ?? DEFAULT_HTTP_RETRY_POLICY.retryableErrorNames,
  };
}

export function isRetryableHttpStatus(
  policy: HttpRetryPolicy,
  status: number,
): boolean {
  return policy.retryableStatusCodes.includes(status);
}

export function isRetryableNetworkError(
  policy: HttpRetryPolicy,
  error: unknown,
): boolean {
  if (error instanceof CliError) return error.exitCode === EXIT_CODES.TEMPFAIL;

  const code = errorCodeOf(error);
  if (code && policy.retryableNetworkCodes.includes(code)) return true;

  if (!(error instanceof Error)) return false;
  if (policy.retryableErrorNames.includes(error.name)) return true;
  return error.name === 'TypeError' && /fetch failed|network|socket|connect|timed? out|terminated/i.test(error.message);
}

export function computeRetryDelayMs(
  policy: HttpRetryPolicy,
  attempt: number,
  retryAfterHeader?: string | null,
): number {
  if (policy.respectRetryAfter) {
    const retryAfterMs = parseRetryAfterMs(retryAfterHeader);
    if (retryAfterMs != null) return clampDelayMs(retryAfterMs, policy.maxDelayMs);
  }
  const exponentialDelay = policy.baseDelayMs * Math.pow(policy.backoffFactor, attempt);
  return clampDelayMs(exponentialDelay, policy.maxDelayMs);
}

export async function executeHttpRequestWithRetry(opts: {
  backendId: string;
  execute: () => Promise<Response>;
  policy?: HttpRetryPolicyOverrides;
  onRetryableStatusExhausted: (status: number, attempts: number) => CliError;
  onNonRetryableStatus: (response: Response) => CliError | Promise<CliError>;
  onNetworkErrorExhausted: (error: Error, attempts: number) => CliError;
}): Promise<Response> {
  const policy = resolveHttpRetryPolicy(opts.backendId, opts.policy);
  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= policy.maxRetries; attempt++) {
    try {
      const response = await opts.execute();

      if (isRetryableHttpStatus(policy, response.status)) {
        if (attempt < policy.maxRetries) {
          try { await response.text(); } catch { /* ignore */ }
          await sleep(computeRetryDelayMs(policy, attempt, response.headers.get('Retry-After')));
          continue;
        }
        throw opts.onRetryableStatusExhausted(response.status, policy.maxRetries + 1);
      }

      if (!response.ok) {
        throw await opts.onNonRetryableStatus(response);
      }

      return response;
    } catch (error) {
      if (error instanceof CliError) throw error;

      lastError = error instanceof Error ? error : new Error(String(error));
      if (attempt < policy.maxRetries && isRetryableNetworkError(policy, lastError)) {
        await sleep(computeRetryDelayMs(policy, attempt));
        continue;
      }
      throw opts.onNetworkErrorExhausted(lastError, policy.maxRetries + 1);
    }
  }

  throw opts.onNetworkErrorExhausted(
    lastError ?? new Error('unknown error'),
    policy.maxRetries + 1,
  );
}

export function buildRetryableApiError(message: string, hint?: string): ApiError {
  return new ApiError(message, hint, EXIT_CODES.TEMPFAIL);
}

export function buildRetryableRateLimitError(message: string, hint?: string): RateLimitError {
  return new RateLimitError(message, hint);
}
