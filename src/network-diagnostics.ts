export type NetworkFailureType =
  | 'environment'
  | 'dns'
  | 'timeout'
  | 'network'
  | 'unknown';

export interface NetworkFailureDiagnosis {
  type: NetworkFailureType;
  code?: string;
  detail: string;
  hint: string;
}

function errorCodeOf(error: unknown): string | undefined {
  if (!error || typeof error !== 'object') return undefined;
  if ('code' in error && typeof error.code === 'string') return error.code;
  if ('cause' in error && error.cause && typeof error.cause === 'object' && 'code' in error.cause && typeof error.cause.code === 'string') {
    return error.cause.code;
  }
  return undefined;
}

function isAbortTimeout(error: Error, code?: string): boolean {
  return error.name === 'AbortError'
    || code === 'UND_ERR_CONNECT_TIMEOUT'
    || code === 'ETIMEDOUT'
    || /timed? out|timeout/i.test(error.message);
}

function executionEnvironmentHint(): string | undefined {
  if (process.env.CODEX_SANDBOX_NETWORK_DISABLED === '1') {
    return 'Current execution environment reports outbound network disabled for Node/CLI requests (CODEX_SANDBOX_NETWORK_DISABLED=1). Retry in a terminal or agent session with network access enabled.';
  }
  return undefined;
}

export function diagnoseNetworkFailure(
  error: unknown,
  opts?: { serviceName?: string; url?: string; fallbackHint?: string },
): NetworkFailureDiagnosis {
  const serviceName = opts?.serviceName ?? 'Upstream service';
  const defaultHint = opts?.fallbackHint
    ?? `Check ${serviceName}${opts?.url ? ` at ${opts.url}` : ''} and retry.`;
  const code = errorCodeOf(error);
  const detail = error instanceof Error ? error.message : String(error);
  const envHint = executionEnvironmentHint();

  if (envHint) {
    return {
      type: 'environment',
      code,
      detail: `${serviceName} request failed inside a network-restricted execution environment`,
      hint: envHint,
    };
  }

  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') {
    return {
      type: 'dns',
      code,
      detail: `${serviceName} hostname could not be resolved`,
      hint: `DNS resolution failed while reaching ${serviceName}${opts?.url ? ` (${opts.url})` : ''}. Check resolver, proxy, or VPN settings, then retry.`,
    };
  }

  if (error instanceof Error && isAbortTimeout(error, code)) {
    return {
      type: 'timeout',
      code,
      detail: `${serviceName} request timed out`,
      hint: `The request to ${serviceName} timed out${opts?.url ? ` (${opts.url})` : ''}. Retry later or from a network with lower latency.`,
    };
  }

  if (code === 'ECONNREFUSED' || code === 'ECONNRESET' || code === 'ENETUNREACH' || (error instanceof Error && /fetch failed|network|socket|connect/i.test(error.message))) {
    return {
      type: 'network',
      code,
      detail: `${serviceName} request could not establish a working network connection`,
      hint: defaultHint,
    };
  }

  return {
    type: 'unknown',
    code,
    detail: `${serviceName} request failed`,
    hint: defaultHint,
  };
}
