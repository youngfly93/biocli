/**
 * biocli verify — Unified verification: validate + doctor + optional smoke.
 *
 * Runs all diagnostic checks in sequence and reports a summary.
 */

import chalk from 'chalk';
import { validateAll } from './validate.js';
import { runDoctor } from './doctor.js';
import { BUILTIN_CLIS_DIR } from './discovery.js';
import { generateCompletion } from './completion.js';
import { getConfigPath } from './config.js';
import { getRegistry } from './registry.js';
import { biocliResultSchema, resultWithMetaSchema } from './schema.js';
import { getVersion } from './version.js';

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
  const checks: Array<{ name: string; check: () => void }> = [
    {
      name: 'version',
      check: () => {
        if (!getVersion() || getVersion() === '0.0.0') {
          throw new Error('invalid version');
        }
      },
    },
    {
      name: 'list',
      check: () => {
        if (getRegistry().size === 0) {
          throw new Error('empty registry');
        }
      },
    },
    {
      name: 'config path',
      check: () => {
        if (!getConfigPath().endsWith('/config.yaml')) {
          throw new Error('bad config path');
        }
      },
    },
    {
      name: 'schema',
      check: () => {
        if (biocliResultSchema.title !== 'BiocliResult') {
          throw new Error('bad schema');
        }
      },
    },
    {
      name: 'schema meta',
      check: () => {
        if (resultWithMetaSchema.title !== 'ResultWithMeta') {
          throw new Error('bad meta schema');
        }
      },
    },
    {
      name: 'completion bash',
      check: () => {
        const script = generateCompletion('bash');
        if (!script.includes('complete -F _biocli_completions biocli')) {
          throw new Error('bad completion');
        }
      },
    },
  ];

  for (const smokeCheck of checks) {
    try {
      smokeCheck.check();
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'unknown error';
      return { step: 'smoke', ok: false, detail: `${smokeCheck.name}: ${detail}` };
    }
  }

  return { step: 'smoke', ok: true, detail: `Core smoke tests passed (${checks.length} checks)` };
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
