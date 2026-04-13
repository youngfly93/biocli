import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  buildPipelineReport,
  parseReportArgs,
  type RunSummary,
  type ResumeSummary,
} from './lib.js';

function loadJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf-8')) as T;
}

const { date } = parseReportArgs(process.argv.slice(2));
const root = join('benchmarks', 'pipeline', 'results', date);
const coldPath = join(root, 'cold', 'summary.json');
const warmPath = join(root, 'warm', 'summary.json');
const resumePath = join(root, 'resume', 'gene-profile-interruption', 'summary.json');

if (!existsSync(coldPath) || !existsSync(warmPath)) {
  throw new Error(`Expected cold and warm summaries under ${root}. Run the pipeline benchmark first.`);
}

const cold = loadJson<RunSummary>(coldPath);
const warm = loadJson<RunSummary>(warmPath);
const resume = existsSync(resumePath) ? loadJson<ResumeSummary>(resumePath) : null;
const { reportJson, reportMd } = buildPipelineReport(cold, warm, resume, {
  date,
  coldPath,
  warmPath,
  resumePath,
});

writeFileSync(join(root, 'report.json'), `${JSON.stringify(reportJson, null, 2)}\n`);
writeFileSync(join(root, 'report.md'), `${reportMd}\n`);

console.log(`Pipeline benchmark report written to ${join(root, 'report.md')}`);
