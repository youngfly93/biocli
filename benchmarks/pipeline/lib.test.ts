import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  PIPELINE_TASKS,
  buildPipelineReport,
  cliCommand,
  countJsonlRows,
  parseReportArgs,
  parseResumeArgs,
  parseRunArgs,
  readManifestSummary,
  todayIso,
  type ResumeSummary,
  type RunSummary,
} from './lib.js';

describe('pipeline benchmark helpers', () => {
  it('parses run args with defaults and overrides', () => {
    expect(parseRunArgs([], '2026-04-13')).toEqual({
      date: '2026-04-13',
      cacheMode: 'cold',
      cliMode: 'src',
    });

    expect(parseRunArgs(['--date', '2026-04-12', '--cache-mode', 'warm', '--cli', 'dist'], '2026-04-13')).toEqual({
      date: '2026-04-12',
      cacheMode: 'warm',
      cliMode: 'dist',
    });
  });

  it('parses resume and report args with expected defaults', () => {
    expect(parseResumeArgs([], '2026-04-13')).toEqual({
      date: '2026-04-13',
      cliMode: 'dist',
    });
    expect(parseReportArgs([], '2026-04-13')).toEqual({
      date: '2026-04-13',
    });
  });

  it('formats date as ISO day', () => {
    expect(todayIso(new Date('2026-04-13T01:02:03.000Z'))).toBe('2026-04-13');
  });

  it('returns the expected CLI command for source and dist modes', () => {
    expect(cliCommand('src')).toEqual(['npx', 'tsx', 'src/main.ts']);

    const root = mkdtempSync(join(tmpdir(), 'biocli-bench-cli-'));
    mkdirSync(join(root, 'dist'), { recursive: true });
    writeFileSync(join(root, 'dist', 'main.js'), 'console.log("ok");\n');
    expect(cliCommand('dist', root)).toEqual(['node', join(root, 'dist', 'main.js')]);
  });

  it('throws when dist mode is requested without a built entrypoint', () => {
    const root = mkdtempSync(join(tmpdir(), 'biocli-bench-missing-dist-'));
    expect(() => cliCommand('dist', root)).toThrow(/dist\/main\.js is missing/);
  });

  it('reads manifest summaries and counts jsonl rows', () => {
    const root = mkdtempSync(join(tmpdir(), 'biocli-bench-summary-'));
    const manifestPath = join(root, 'manifest.json');
    writeFileSync(manifestPath, JSON.stringify({
      succeeded: 8,
      failed: 1,
      durationSeconds: 12.3,
      cache: { hits: 4, misses: 4 },
      snapshots: [{ dataset: 'GDSC', release: '8.5' }],
    }));

    expect(readManifestSummary(manifestPath)).toEqual({
      succeeded: 8,
      failed: 1,
      durationSeconds: 12.3,
      cache: { hits: 4, misses: 4 },
      snapshots: [{ dataset: 'GDSC', release: '8.5' }],
    });

    const resultsPath = join(root, 'results.jsonl');
    writeFileSync(resultsPath, '{"a":1}\n{"a":2}\n\n{"a":3}\n');
    expect(countJsonlRows(resultsPath)).toBe(3);
  });

  it('builds a report with speedups, snapshots, and resume details', () => {
    const cold: RunSummary = {
      date: '2026-04-13',
      cacheMode: 'cold',
      cliMode: 'dist',
      generatedAt: '2026-04-13T00:00:00.000Z',
      tasks: [
        {
          taskId: 'gene-profile-batch',
          title: 'Gene profile',
          status: 'ok',
          exitCode: 0,
          durationMs: 1000,
          summary: { cache: { hits: 0, misses: 10, writes: 10 } },
        },
        {
          taskId: 'drug-target-batch',
          title: 'Drug target',
          status: 'ok',
          exitCode: 0,
          durationMs: 2000,
          summary: {
            cache: { hits: 0, misses: 8, writes: 8 },
            snapshots: [{ dataset: 'GDSC', release: '8.5' }],
          },
        },
      ],
    };
    const warm: RunSummary = {
      date: '2026-04-13',
      cacheMode: 'warm',
      cliMode: 'dist',
      generatedAt: '2026-04-13T00:01:00.000Z',
      tasks: [
        {
          taskId: 'gene-profile-batch',
          title: 'Gene profile',
          status: 'ok',
          exitCode: 0,
          durationMs: 100,
          summary: { cache: { hits: 10, misses: 0, writes: 0 } },
        },
        {
          taskId: 'drug-target-batch',
          title: 'Drug target',
          status: 'ok',
          exitCode: 0,
          durationMs: 200,
          summary: { cache: { hits: 8, misses: 0, writes: 0 } },
        },
      ],
    };
    const resume: ResumeSummary = {
      date: '2026-04-13',
      cliMode: 'dist',
      taskId: 'gene-profile-resume',
      interruption: {
        signal: 'SIGTERM',
        thresholdSucceeded: 3,
        observedSucceeded: 3,
        durationMs: 12000,
      },
      resume: {
        status: 'ok',
        exitCode: 0,
        durationMs: 23000,
      },
      final: {
        succeeded: 10,
        failed: 0,
        skippedCompleted: 3,
        durationSeconds: 22.8,
      },
    };

    const { reportJson, reportMd } = buildPipelineReport(cold, warm, resume, {
      date: '2026-04-13',
      coldPath: 'cold/summary.json',
      warmPath: 'warm/summary.json',
      resumePath: 'resume/summary.json',
    });

    expect(reportJson).toMatchObject({
      date: '2026-04-13',
      cold: { tasks: 2 },
      warm: { tasks: 2 },
      resume,
    });
    expect(reportMd).toContain('| gene-profile-batch | 1000 ms | 100 ms | 10.0x | 10/10 |');
    expect(reportMd).toContain('GDSC (8.5)');
    expect(reportMd).toContain('Resume checkpoint skipped completed: `3`');
  });

  it('keeps the three hero workflow task specs stable', () => {
    expect(PIPELINE_TASKS.map(task => task.id)).toEqual([
      'gene-profile-batch',
      'drug-target-batch',
      'tumor-gene-dossier-batch',
    ]);
  });
});
