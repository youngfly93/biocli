import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';

type CliMode = 'src' | 'dist';

interface Args {
  date: string;
  cliMode: CliMode;
}

interface ResumeBenchmarkSummary {
  date: string;
  cliMode: CliMode;
  taskId: string;
  generatedAt: string;
  interruption: {
    signal: string;
    thresholdSucceeded: number;
    observedSucceeded: number;
    durationMs: number;
    stdoutPath: string;
    stderrPath: string;
  };
  resume: {
    status: 'ok' | 'failed';
    exitCode: number | null;
    durationMs: number;
    stdoutPath: string;
    stderrPath: string;
  };
  final: {
    manifestPath: string;
    succeeded: number;
    failed: number;
    skippedCompleted: number;
    durationSeconds?: number;
  };
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function parseArgs(argv: string[]): Args {
  let date = todayIso();
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

function countJsonlRows(path: string): number {
  if (!existsSync(path)) return 0;
  const raw = readFileSync(path, 'utf-8').trim();
  if (!raw) return 0;
  return raw.split('\n').filter(Boolean).length;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolvePromise => setTimeout(resolvePromise, ms));
}

async function waitForSucceededRows(path: string, minRows: number, timeoutMs: number): Promise<number> {
  const started = Date.now();
  let count = countJsonlRows(path);
  while (Date.now() - started < timeoutMs) {
    count = countJsonlRows(path);
    if (count >= minRows) return count;
    await sleep(250);
  }
  return count;
}

const args = parseArgs(process.argv.slice(2));
const cli = cliCommand(args.cliMode);

const resultRoot = join('benchmarks', 'pipeline', 'results', args.date, 'resume');
const scenarioRoot = join(resultRoot, 'gene-profile-interruption');
const outdir = join(scenarioRoot, 'gene-profile-run');
const logDir = join(scenarioRoot, 'logs');
const homeDir = join('benchmarks', 'pipeline', 'results', args.date, '.cache-home', 'gene-profile-resume');
const resultsJsonl = join(outdir, 'results.jsonl');
const interruptedStdoutPath = join(logDir, 'interrupted.stdout.txt');
const interruptedStderrPath = join(logDir, 'interrupted.stderr.txt');
const resumeStdoutPath = join(logDir, 'resume.stdout.txt');
const resumeStderrPath = join(logDir, 'resume.stderr.txt');
const manifestPath = join(outdir, 'manifest.json');

rmSync(scenarioRoot, { recursive: true, force: true });
rmSync(homeDir, { recursive: true, force: true });
mkdirSync(logDir, { recursive: true });
mkdirSync(homeDir, { recursive: true });

const baseArgs = [
  ...cli,
  'aggregate', 'gene-profile',
  '--input-file', 'benchmarks/pipeline/fixtures/gene-profile.genes.txt',
  '--organism', 'human',
  '--concurrency', '1',
  '--outdir', outdir,
  '-f', 'json',
];

const env = {
  ...process.env,
  HOME: resolve(homeDir),
  TMPDIR: process.env.TMPDIR || '/tmp',
};

const thresholdSucceeded = 3;
const interruptionStarted = Date.now();
const child = spawn(baseArgs[0]!, baseArgs.slice(1), {
  cwd: process.cwd(),
  env,
  stdio: ['ignore', 'pipe', 'pipe'],
});

let interruptedStdout = '';
let interruptedStderr = '';
child.stdout?.on('data', chunk => {
  interruptedStdout += String(chunk);
});
child.stderr?.on('data', chunk => {
  interruptedStderr += String(chunk);
});

const observedSucceeded = await waitForSucceededRows(resultsJsonl, thresholdSucceeded, 30_000);
if (observedSucceeded < thresholdSucceeded) {
  child.kill('SIGKILL');
  throw new Error(`Interrupted run did not reach ${thresholdSucceeded} completed rows before timeout; observed ${observedSucceeded}.`);
}

child.kill('SIGTERM');
const interruptionExit = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolvePromise) => {
  const hardKill = setTimeout(() => {
    child.kill('SIGKILL');
  }, 5_000);
  child.on('exit', (code, signal) => {
    clearTimeout(hardKill);
    resolvePromise({ code, signal });
  });
});
const interruptionDurationMs = Date.now() - interruptionStarted;
writeFileSync(interruptedStdoutPath, interruptedStdout);
writeFileSync(interruptedStderrPath, interruptedStderr);

const resumeStarted = Date.now();
const resumeProc = spawnSync(baseArgs[0]!, [...baseArgs.slice(1), '--resume'], {
  cwd: process.cwd(),
  env,
  encoding: 'utf8',
  timeout: 30 * 60 * 1000,
  maxBuffer: 50 * 1024 * 1024,
});
const resumeDurationMs = Date.now() - resumeStarted;
writeFileSync(resumeStdoutPath, resumeProc.stdout ?? '');
writeFileSync(resumeStderrPath, resumeProc.stderr ?? '');

if (!existsSync(manifestPath)) {
  throw new Error(`Resume benchmark did not produce manifest: ${manifestPath}`);
}

const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8')) as {
  succeeded: number;
  failed: number;
  durationSeconds?: number;
  resume?: {
    skippedCompleted?: number;
  };
};

const summary: ResumeBenchmarkSummary = {
  date: args.date,
  cliMode: args.cliMode,
  taskId: 'gene-profile-resume',
  generatedAt: new Date().toISOString(),
  interruption: {
    signal: interruptionExit.signal ?? 'SIGTERM',
    thresholdSucceeded,
    observedSucceeded,
    durationMs: interruptionDurationMs,
    stdoutPath: interruptedStdoutPath,
    stderrPath: interruptedStderrPath,
  },
  resume: {
    status: resumeProc.status === 0 ? 'ok' : 'failed',
    exitCode: resumeProc.status,
    durationMs: resumeDurationMs,
    stdoutPath: resumeStdoutPath,
    stderrPath: resumeStderrPath,
  },
  final: {
    manifestPath,
    succeeded: manifest.succeeded,
    failed: manifest.failed,
    skippedCompleted: manifest.resume?.skippedCompleted ?? 0,
    durationSeconds: manifest.durationSeconds,
  },
};

writeFileSync(join(scenarioRoot, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
console.log(`resume benchmark: ${summary.resume.status.toUpperCase()} (partial=${observedSucceeded}, final=${summary.final.succeeded})`);
console.log(`\nResume benchmark summary written to ${join(scenarioRoot, 'summary.json')}`);
