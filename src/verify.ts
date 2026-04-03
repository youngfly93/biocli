/**
 * biocli verify — Unified verification: validate + doctor + optional smoke.
 *
 * Runs all diagnostic checks in sequence and reports a summary.
 */

import chalk from 'chalk';
import { validateAll } from './validate.js';
import { runDoctor } from './doctor.js';
import { BUILTIN_CLIS_DIR } from './discovery.js';
import { spawnSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// ── Types ────────────────────────────────────────────────────────────────────

interface StepResult {
  step: string;
  ok: boolean;
  detail: string;
}

export interface VerifyResult {
  steps: StepResult[];
  allPassed: boolean;
}

// ── Steps ────────────────────────────────────────────────────────────────────

function runValidateStep(): StepResult {
  const errors = validateAll(BUILTIN_CLIS_DIR);
  const totalErrors = errors.reduce((n, e) => n + e.errors.length, 0);
  return {
    step: 'validate',
    ok: totalErrors === 0,
    detail: totalErrors === 0
      ? 'All YAML adapters valid'
      : `${totalErrors} validation error(s) in ${errors.length} file(s)`,
  };
}

async function runDoctorStep(): Promise<StepResult> {
  const { checks, allPassed } = await runDoctor();
  const failed = checks.filter(c => !c.ok);
  return {
    step: 'doctor',
    ok: allPassed,
    detail: allPassed
      ? `All ${checks.length} checks passed`
      : `${failed.length} check(s) failed: ${failed.map(c => c.name).join(', ')}`,
  };
}

function runSmokeStep(): StepResult {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const result = spawnSync('bash', [resolve(root, 'scripts/smoke-core.sh')], {
    cwd: root,
    encoding: 'utf8',
    timeout: 60_000,
    env: { ...process.env },
  });

  if (result.status === 0) {
    return { step: 'smoke', ok: true, detail: 'Core smoke tests passed' };
  }

  const errMsg = (result.stderr || result.stdout || '').trim().split('\n').pop() ?? 'unknown error';
  return { step: 'smoke', ok: false, detail: errMsg };
}

// ── Main ─────────────────────────────────────────────────────────────────────

export async function runVerify(opts: { smoke?: boolean } = {}): Promise<VerifyResult> {
  const steps: StepResult[] = [];

  steps.push(runValidateStep());
  steps.push(await runDoctorStep());

  if (opts.smoke) {
    steps.push(runSmokeStep());
  }

  return { steps, allPassed: steps.every(s => s.ok) };
}

// ── Formatters ───────────────────────────────────────────────────────────────

export function formatVerifyText(result: VerifyResult): string {
  const lines: string[] = ['', chalk.bold('biocli verify'), ''];

  for (const step of result.steps) {
    const status = step.ok ? chalk.green('PASS') : chalk.red('FAIL');
    lines.push(`  ${step.step.padEnd(12)} ${status}  ${chalk.dim(step.detail)}`);
  }

  lines.push('');
  if (result.allPassed) {
    lines.push(chalk.green(`  All ${result.steps.length} steps passed.`));
  } else {
    const passed = result.steps.filter(s => s.ok).length;
    lines.push(chalk.yellow(`  ${passed}/${result.steps.length} steps passed.`));
  }
  lines.push('');
  return lines.join('\n');
}

export function formatVerifyJson(result: VerifyResult): string {
  return JSON.stringify(result, null, 2);
}
