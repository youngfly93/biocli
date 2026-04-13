import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

type CacheMode = 'cold' | 'warm';
type CliMode = 'src' | 'dist';

interface TaskSpec {
  id: string;
  title: string;
  outdirName: string;
  baseArgs: string[];
}

interface Args {
  date: string;
  cacheMode: CacheMode;
  cliMode: CliMode;
}

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

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function parseArgs(argv: string[]): Args {
  let date = todayIso();
  let cacheMode: CacheMode = 'cold';
  let cliMode: CliMode = 'src';

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--date') {
      date = argv[i + 1] ?? date;
      i += 1;
    } else if (arg === '--cache-mode') {
      const value = argv[i + 1] as CacheMode | undefined;
      if (value === 'cold' || value === 'warm') cacheMode = value;
      i += 1;
    } else if (arg === '--cli') {
      const value = argv[i + 1] as CliMode | undefined;
      if (value === 'src' || value === 'dist') cliMode = value;
      i += 1;
    }
  }

  return { date, cacheMode, cliMode };
}

function cliCommand(mode: CliMode): string[] {
  if (mode === 'dist') {
    const distEntry = join(process.cwd(), 'dist', 'main.js');
    if (!existsSync(distEntry)) {
      throw new Error('dist/main.js is missing. Run "npm run build" or use --cli src.');
    }
    return ['node', distEntry];
  }
  return ['npx', 'tsx', 'src/main.ts'];
}

function readManifestSummary(path: string): TaskRunSummary['summary'] | undefined {
  if (!existsSync(path)) return undefined;
  const manifest = JSON.parse(readFileSync(path, 'utf-8')) as {
    succeeded?: number;
    failed?: number;
    durationSeconds?: number;
    cache?: unknown;
    snapshots?: unknown;
  };
  return {
    succeeded: manifest.succeeded,
    failed: manifest.failed,
    durationSeconds: manifest.durationSeconds,
    cache: manifest.cache,
    snapshots: manifest.snapshots,
  };
}

const TASKS: TaskSpec[] = [
  {
    id: 'gene-profile-batch',
    title: 'Batch gene-profile over a representative cancer gene list',
    outdirName: 'gene-profile-run',
    baseArgs: [
      'aggregate', 'gene-profile',
      '--input-file', 'benchmarks/pipeline/fixtures/gene-profile.genes.txt',
      '--organism', 'human',
      '--concurrency', '4',
      '-f', 'json',
    ],
  },
  {
    id: 'drug-target-batch',
    title: 'Batch drug-target scan over actionable lung cancer genes',
    outdirName: 'drug-target-run',
    baseArgs: [
      'aggregate', 'drug-target',
      '--input-file', 'benchmarks/pipeline/fixtures/drug-target.genes.txt',
      '--disease', 'lung',
      '--concurrency', '2',
      '--limit', '5',
      '--diseaseLimit', '5',
      '--reportLimit', '2',
      '-f', 'json',
    ],
  },
  {
    id: 'tumor-gene-dossier-batch',
    title: 'Batch tumor-gene-dossier over a LUAD cohort gene list',
    outdirName: 'tumor-gene-dossier-run',
    baseArgs: [
      'aggregate', 'tumor-gene-dossier',
      '--input-file', 'benchmarks/pipeline/fixtures/tumor-gene-dossier.genes.txt',
      '--study', 'luad_tcga_pan_can_atlas_2018',
      '--organism', 'human',
      '--papers', '3',
      '--co-mutations', '5',
      '--variants', '3',
      '--min-co-samples', '1',
      '--page-size', '500',
      '--concurrency', '2',
      '-f', 'json',
    ],
  },
];

const args = parseArgs(process.argv.slice(2));
const cli = cliCommand(args.cliMode);
const resultRoot = join('benchmarks', 'pipeline', 'results', args.date, args.cacheMode);
mkdirSync(resultRoot, { recursive: true });

const summaries: TaskRunSummary[] = [];

for (const task of TASKS) {
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
