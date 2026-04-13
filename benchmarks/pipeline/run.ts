import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  PIPELINE_TASKS,
  cliCommand,
  parseRunArgs,
  readManifestSummary,
  type TaskSpec,
  type RunArgs,
} from './lib.js';

interface TaskRunSummary {
  taskId: string;
  title: string;
  status: 'ok' | 'failed';
  exitCode: number | null;
  durationMs: number;
  command: string[];
  outdir: string;
  manifestPath?: string;
  summary?: {
    succeeded?: number;
    failed?: number;
    durationSeconds?: number;
    cache?: unknown;
    snapshots?: unknown;
  };
}

const args: RunArgs = parseRunArgs(process.argv.slice(2));
const cli = cliCommand(args.cliMode);
const resultRoot = join('benchmarks', 'pipeline', 'results', args.date, args.cacheMode);
mkdirSync(resultRoot, { recursive: true });

const summaries: TaskRunSummary[] = [];

for (const task of PIPELINE_TASKS) {
  const taskRoot = join(resultRoot, task.id);
  const outdir = join(taskRoot, task.outdirName);
  const logDir = join(taskRoot, 'logs');
  const homeDir = join('benchmarks', 'pipeline', 'results', args.date, '.cache-home', task.id);
  if (args.cacheMode === 'cold') {
    rmSync(homeDir, { recursive: true, force: true });
  }
  mkdirSync(logDir, { recursive: true });
  mkdirSync(homeDir, { recursive: true });

  const command = [
    ...cli,
    ...task.baseArgs,
    '--outdir', outdir,
    ...(args.cacheMode === 'warm' ? ['--skip-cached'] : []),
  ];
  const started = Date.now();
  const proc = spawnSync(command[0]!, command.slice(1), {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: {
      ...process.env,
      HOME: resolve(homeDir),
      TMPDIR: process.env.TMPDIR || '/tmp',
    },
    timeout: 30 * 60 * 1000,
    maxBuffer: 50 * 1024 * 1024,
  });
  const durationMs = Date.now() - started;
  writeFileSync(join(logDir, 'stdout.txt'), proc.stdout ?? '');
  writeFileSync(join(logDir, 'stderr.txt'), proc.stderr ?? '');

  const manifestPath = join(outdir, 'manifest.json');
  const summary: TaskRunSummary = {
    taskId: task.id,
    title: task.title,
    status: proc.status === 0 ? 'ok' : 'failed',
    exitCode: proc.status,
    durationMs,
    command,
    outdir,
    ...(existsSync(manifestPath) ? { manifestPath } : {}),
    ...(existsSync(manifestPath) ? { summary: readManifestSummary(manifestPath) } : {}),
  };
  summaries.push(summary);
  console.log(`${task.id}: ${summary.status.toUpperCase()} (${durationMs}ms)`);
}

writeFileSync(
  join(resultRoot, 'summary.json'),
  `${JSON.stringify({
    date: args.date,
    cacheMode: args.cacheMode,
    cliMode: args.cliMode,
    generatedAt: new Date().toISOString(),
    tasks: summaries,
  }, null, 2)}\n`,
);

console.log(`\nBatch benchmark summary written to ${join(resultRoot, 'summary.json')}`);
