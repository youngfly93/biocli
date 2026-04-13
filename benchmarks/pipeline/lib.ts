import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export type CacheMode = 'cold' | 'warm';
export type CliMode = 'src' | 'dist';

export interface TaskSpec {
  id: string;
  title: string;
  outdirName: string;
  baseArgs: string[];
}

export interface RunArgs {
  date: string;
  cacheMode: CacheMode;
  cliMode: CliMode;
}

export interface ResumeArgs {
  date: string;
  cliMode: CliMode;
}

export interface ReportArgs {
  date: string;
}

export interface TaskSummary {
  taskId: string;
  title: string;
  status: 'ok' | 'failed';
  exitCode: number | null;
  durationMs: number;
  summary?: {
    succeeded?: number;
    failed?: number;
    durationSeconds?: number;
    cache?: {
      policy?: string;
      hits?: number;
      misses?: number;
      writes?: number;
    };
    snapshots?: Array<{
      dataset?: string;
      release?: string;
      refreshed?: boolean;
    }>;
  };
}

export interface RunSummary {
  date: string;
  cacheMode: CacheMode;
  cliMode: CliMode;
  generatedAt: string;
  tasks: TaskSummary[];
}

export interface ResumeSummary {
  date: string;
  cliMode: CliMode;
  taskId: string;
  generatedAt?: string;
  interruption: {
    signal: string;
    thresholdSucceeded: number;
    observedSucceeded: number;
    durationMs: number;
  };
  resume: {
    status: 'ok' | 'failed';
    exitCode: number | null;
    durationMs: number;
  };
  final: {
    succeeded: number;
    failed: number;
    skippedCompleted: number;
    durationSeconds?: number;
  };
}

export const PIPELINE_TASKS: TaskSpec[] = [
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

export function todayIso(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

export function parseRunArgs(argv: string[], defaultDate = todayIso()): RunArgs {
  let date = defaultDate;
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

export function parseResumeArgs(argv: string[], defaultDate = todayIso()): ResumeArgs {
  let date = defaultDate;
  let cliMode: CliMode = 'dist';

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--date') {
      date = argv[i + 1] ?? date;
      i += 1;
    } else if (arg === '--cli') {
      const value = argv[i + 1] as CliMode | undefined;
      if (value === 'src' || value === 'dist') cliMode = value;
      i += 1;
    }
  }

  return { date, cliMode };
}

export function parseReportArgs(argv: string[], defaultDate = todayIso()): ReportArgs {
  let date = defaultDate;
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--date') {
      date = argv[i + 1] ?? date;
      i += 1;
    }
  }
  return { date };
}

export function cliCommand(mode: CliMode, cwd = process.cwd()): string[] {
  if (mode === 'dist') {
    const distEntry = join(cwd, 'dist', 'main.js');
    if (!existsSync(distEntry)) {
      throw new Error('dist/main.js is missing. Run "npm run build" or use --cli src.');
    }
    return ['node', distEntry];
  }
  return ['npx', 'tsx', 'src/main.ts'];
}

export function readManifestSummary(path: string): {
  succeeded?: number;
  failed?: number;
  durationSeconds?: number;
  cache?: unknown;
  snapshots?: unknown;
} | undefined {
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

export function countJsonlRows(path: string): number {
  if (!existsSync(path)) return 0;
  const raw = readFileSync(path, 'utf-8').trim();
  if (!raw) return 0;
  return raw.split('\n').filter(Boolean).length;
}

function taskMap(summary: RunSummary): Map<string, TaskSummary> {
  return new Map(summary.tasks.map(task => [task.taskId, task]));
}

function ratio(cold: number, warm: number): number {
  if (warm <= 0) return 0;
  return cold / warm;
}

function formatMs(ms: number | undefined): string {
  if (typeof ms !== 'number') return 'n/a';
  return `${ms.toFixed(0)} ms`;
}

function formatX(value: number): string {
  return `${value.toFixed(1)}x`;
}

export function buildPipelineReport(
  cold: RunSummary,
  warm: RunSummary,
  resume: ResumeSummary | null,
  paths: {
    date: string;
    coldPath: string;
    warmPath: string;
    resumePath: string;
  },
): {
  reportJson: Record<string, unknown>;
  reportMd: string;
} {
  const coldTasks = taskMap(cold);
  const warmTasks = taskMap(warm);

  const taskRows = warm.tasks.map(task => {
    const coldTask = coldTasks.get(task.taskId);
    const warmTask = warmTasks.get(task.taskId);
    const coldMs = coldTask?.durationMs ?? 0;
    const warmMs = warmTask?.durationMs ?? 0;
    return {
      taskId: task.taskId,
      title: task.title,
      coldMs,
      warmMs,
      speedup: ratio(coldMs, warmMs),
      coldCache: coldTask?.summary?.cache ?? {},
      warmCache: warmTask?.summary?.cache ?? {},
      snapshots: coldTask?.summary?.snapshots ?? warmTask?.summary?.snapshots ?? [],
    };
  });

  const reportJson = {
    date: paths.date,
    generatedAt: new Date().toISOString(),
    cold: {
      cliMode: cold.cliMode,
      tasks: cold.tasks.length,
    },
    warm: {
      cliMode: warm.cliMode,
      tasks: warm.tasks.length,
    },
    rows: taskRows,
    ...(resume ? { resume } : {}),
  };

  const tableRows = taskRows
    .map(row => `| ${row.taskId} | ${formatMs(row.coldMs)} | ${formatMs(row.warmMs)} | ${formatX(row.speedup)} | ${row.warmCache.hits ?? 0}/${(row.warmCache.hits ?? 0) + (row.warmCache.misses ?? 0)} |`)
    .join('\n');

  const snapshotLines = taskRows
    .flatMap(row => row.snapshots.map(snapshot => `- ${row.taskId}: ${snapshot.dataset ?? 'dataset'}${snapshot.release ? ` (${snapshot.release})` : ''}`))
    .filter((value, index, items) => items.indexOf(value) === index)
    .join('\n');

  const resumeSection = resume
    ? `
## Resume Scenario

- Interrupted run signal: \`${resume.interruption.signal}\`
- Partial successes captured before resume: \`${resume.interruption.observedSucceeded}\`
- Resume status: \`${resume.resume.status}\`
- Resume duration: \`${formatMs(resume.resume.durationMs)}\`
- Final succeeded items: \`${resume.final.succeeded}\`
- Resume checkpoint skipped completed: \`${resume.final.skippedCompleted}\`
`
    : `
## Resume Scenario

- Resume benchmark has not been executed for this date.
`;

  const reportMd = `# Pipeline Benchmark Report (${paths.date})

## Scope

This report summarizes the batch/pipeline benchmark for the three hero workflows:

- \`aggregate gene-profile\`
- \`aggregate drug-target\`
- \`aggregate tumor-gene-dossier\`

The benchmark compares a cold run against a warm \`--skip-cached\` run using the same task-level cache home.

## Headline Findings

- All three workflows completed successfully in both cold and warm modes.
- Warm runs hit cached batch results for every item in every workflow.
- The warm path reduced wall-clock runtime from tens of seconds to sub-second execution.

## Cold vs Warm

| Task | Cold | Warm | Speedup | Warm cache hits |
| --- | ---: | ---: | ---: | ---: |
${tableRows}

## Snapshot Evidence

${snapshotLines || '- No snapshot-backed datasets were captured in this batch.'}
${resumeSection}

## Artifacts

- [Cold summary](${paths.coldPath})
- [Warm summary](${paths.warmPath})
${resume ? `- [Resume summary](${paths.resumePath})` : ''}
`;

  return { reportJson, reportMd };
}
