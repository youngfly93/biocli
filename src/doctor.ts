/**
 * biocli doctor — Diagnose configuration and backend connectivity.
 *
 * Checks Node.js version, config status, API key/email, and
 * reachability of all 6 database backends in parallel.
 */

import chalk from 'chalk';
import { loadConfig, getConfigPath, getApiKey, getEmail } from './config.js';
import { getAllBackends } from './databases/index.js';
import { fetchWithIPv4Fallback } from './http-dispatcher.js';
import { getRegistry } from './registry.js';

// ── Types ────────────────────────────────────────────────────────────────────

interface CheckResult {
  name: string;
  value: string;
  ok: boolean;
  detail?: string;
}

// ── Health-check endpoints per backend ───────────────────────────────────────

const PING_ENDPOINTS: Record<string, string> = {
  ncbi: 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils/einfo.fcgi?retmode=json',
  uniprot: 'https://rest.uniprot.org/uniprotkb/search?query=*&size=1&format=json',
  kegg: 'https://rest.kegg.jp/info/kegg',
  string: 'https://string-db.org/api/json/version',
  ensembl: 'https://rest.ensembl.org/info/ping?content-type=application/json',
  enrichr: 'https://maayanlab.cloud/Enrichr/datasetStatistics',
};

// 15s tolerates dual-stack Happy Eyeballs (IPv6 attempt + IPv4 fallback)
// + slow first-packet on backends like NCBI (3-4s typical)
const PING_TIMEOUT = 15_000;

// ── Core checks ──────────────────────────────────────────────────────────────

function checkNodeVersion(): CheckResult {
  const version = process.version;
  const major = Number(version.slice(1).split('.')[0]);
  return {
    name: 'Node.js',
    value: version,
    ok: major >= 20,
    detail: major < 20 ? 'Requires Node.js >= 20' : undefined,
  };
}

function checkConfig(): CheckResult[] {
  const results: CheckResult[] = [];
  const configPath = getConfigPath();
  const config = loadConfig();
  const hasConfig = Object.keys(config).length > 0;

  results.push({
    name: 'Config',
    value: configPath,
    ok: true,
  });

  const apiKey = getApiKey();
  if (apiKey) {
    const masked = apiKey.slice(0, 4) + '****' + apiKey.slice(-4);
    results.push({
      name: 'API key',
      value: masked,
      ok: true,
      detail: '10 req/s',
    });
  } else {
    results.push({
      name: 'API key',
      value: 'not set',
      ok: true,
      detail: '3 req/s — optional (biocli config set api_key YOUR_KEY for 10 req/s)',
    });
  }

  const email = getEmail();
  results.push({
    name: 'Email',
    value: email ?? 'not set',
    ok: true,
    detail: email ? undefined : 'Optional — recommended for NCBI (biocli config set email YOUR_EMAIL)',
  });

  return results;
}

async function pingBackend(name: string, url: string): Promise<CheckResult> {
  const start = Date.now();
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), PING_TIMEOUT);
    // Use fetchWithIPv4Fallback so doctor benefits from the same IPv4 retry
    // logic that protects data-path commands. On WSL2 / dual-stack networks
    // with broken IPv6, this is the difference between FAIL and OK.
    const response = await fetchWithIPv4Fallback(url, { signal: controller.signal });
    clearTimeout(timeout);
    const elapsed = Date.now() - start;

    // Consume and discard body so Node.js can close the connection promptly
    await response.text().catch(() => {});

    if (response.ok) {
      return { name, value: url.split('/').slice(0, 3).join('/'), ok: true, detail: `${elapsed}ms` };
    }
    return { name, value: url.split('/').slice(0, 3).join('/'), ok: false, detail: `HTTP ${response.status} (${elapsed}ms)` };
  } catch (err) {
    const elapsed = Date.now() - start;
    let msg: string;
    if (err instanceof Error && err.name === 'AbortError') {
      msg = `timeout`;
    } else if (err instanceof Error) {
      // Surface undici cause code (e.g. UND_ERR_CONNECT_TIMEOUT, ENETUNREACH, ECONNREFUSED)
      // so users can distinguish "actually unreachable" from "IPv6 fallback failed"
      const cause = (err as Error & { cause?: { code?: string } }).cause;
      const code = cause?.code;
      msg = code ? `${err.message} [${code}]` : err.message;
    } else {
      msg = String(err);
    }
    return { name, value: url.split('/').slice(0, 3).join('/'), ok: false, detail: `${msg} (${elapsed}ms)` };
  }
}

function checkCommands(): CheckResult {
  const count = getRegistry().size;
  return { name: 'Commands', value: `${count} registered`, ok: count > 0 };
}

// ── Main runner ──────────────────────────────────────────────────────────────

export async function runDoctor(): Promise<{ checks: CheckResult[]; allPassed: boolean }> {
  const checks: CheckResult[] = [];

  // System checks
  checks.push(checkNodeVersion());
  checks.push(...checkConfig());

  // Backend connectivity (parallel)
  const backends = getAllBackends();
  const pingPromises = backends.map(b => {
    const url = PING_ENDPOINTS[b.id] ?? `${b.baseUrl}`;
    return pingBackend(b.name, url);
  });
  const pingResults = await Promise.allSettled(pingPromises);
  for (const result of pingResults) {
    if (result.status === 'fulfilled') {
      checks.push(result.value);
    }
  }

  // Command registry
  checks.push(checkCommands());

  const allPassed = checks.every(c => c.ok);
  return { checks, allPassed };
}

// ── Formatters ───────────────────────────────────────────────────────────────

export function formatDoctorText(checks: CheckResult[], allPassed: boolean): string {
  const lines: string[] = ['', chalk.bold('biocli doctor'), ''];

  for (const check of checks) {
    const status = check.ok ? chalk.green('OK') : chalk.red('FAIL');
    const detail = check.detail ? chalk.dim(` (${check.detail})`) : '';
    const name = check.name.padEnd(14);
    const value = check.value;
    lines.push(`  ${name} ${value.padEnd(44)} ${status}${detail}`);
  }

  const passedCount = checks.filter(c => c.ok).length;
  const failedCount = checks.length - passedCount;
  lines.push('');
  if (allPassed) {
    lines.push(chalk.green(`  All ${checks.length} checks passed.`));
  } else {
    lines.push(chalk.yellow(`  ${passedCount} passed, ${failedCount} failed.`));
  }
  lines.push('');

  return lines.join('\n');
}

export function formatDoctorJson(checks: CheckResult[], allPassed: boolean): string {
  return JSON.stringify({
    allPassed,
    checks: checks.map(c => ({
      name: c.name,
      value: c.value,
      ok: c.ok,
      ...(c.detail ? { detail: c.detail } : {}),
    })),
  }, null, 2);
}
