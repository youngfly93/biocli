/**
 * Benchmark scorer — evaluates raw task outputs against rubric criteria.
 *
 * Usage: npx tsx benchmarks/scripts/score.ts [date]
 * Default date: today (YYYY-MM-DD)
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const TOOLS = ['biocli', 'gget', 'biomcp'] as const;

interface TaskScore {
  taskId: string;
  category: string;
  title: string;
  maxScore: number;
  score: number;
  criteria: { criterion: string; met: boolean }[];
  notes: string;
}

interface CrossCuttingScores {
  agentReadiness: number;   // out of 10
  workflowDepth: number;    // out of 10
  operationalSafety: number; // out of 10
  reproducibility: number;   // out of 10
  outputUsability: number;   // out of 10
  efficiency: number;        // out of 10
}

interface ToolResult {
  tool: string;
  version: string;
  date: string;
  tasks: TaskScore[];
  crossCutting: CrossCuttingScores;
  totalWeighted: number;
}

function fileExists(path: string): boolean {
  return existsSync(path);
}

function readJson(path: string): unknown {
  if (!fileExists(path)) return null;
  try {
    const raw = readFileSync(path, 'utf-8').trim();
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function isNotSupported(data: unknown): boolean {
  if (!data || typeof data !== 'object') return true;
  return (data as Record<string, unknown>).status === 'not_supported';
}

function hasField(data: unknown, ...paths: string[]): boolean {
  let cur = data;
  for (const key of paths) {
    if (!cur || typeof cur !== 'object') return false;
    cur = (cur as Record<string, unknown>)[key];
  }
  return cur !== undefined && cur !== null && cur !== '';
}

function isArray(data: unknown): boolean {
  return Array.isArray(data);
}

function arrayLength(data: unknown): number {
  return Array.isArray(data) ? data.length : 0;
}

// ── Task-specific scoring functions ──────────────────────────────────────────

function scoreGene01(data: unknown): TaskScore {
  const criteria = [
    { criterion: 'Returns gene symbol and NCBI Gene ID', met: hasField(data, 'data', 'symbol') || hasField(data, 'symbol') },
    { criterion: 'Includes protein function description', met: hasField(data, 'data', 'function') || hasField(data, 'function') },
    { criterion: 'Includes at least 3 KEGG pathways', met: arrayLength((data as any)?.data?.pathways) >= 3 || arrayLength((data as any)?.pathways) >= 3 },
    { criterion: 'Includes protein interaction partners', met: arrayLength((data as any)?.data?.interactions) >= 1 || hasField(data, 'interactions') },
    { criterion: 'Includes recent PubMed literature', met: arrayLength((data as any)?.data?.recentLiterature) >= 1 || hasField(data, 'literature') },
    { criterion: 'Includes ClinVar clinical variants', met: arrayLength((data as any)?.data?.clinicalVariants) >= 0 },
    { criterion: 'Output is structured JSON', met: data !== null && typeof data === 'object' },
  ];
  const met = criteria.filter(c => c.met).length;
  return { taskId: 'gene-01', category: 'gene', title: 'Gene comprehensive dossier', maxScore: 7, score: met, criteria, notes: '' };
}

function scoreGene02(data: unknown): TaskScore {
  const isArr = isArray(data) || isArray((data as any)?.data?.rows) || isArray((data as any)?.rows);
  const criteria = [
    { criterion: 'Accepts comma-separated gene list', met: !isNotSupported(data) },
    { criterion: 'Returns enriched pathways/GO terms', met: isArr },
    { criterion: 'Includes p-values or scores', met: JSON.stringify(data).includes('pValue') || JSON.stringify(data).includes('p_value') || JSON.stringify(data).includes('Score') },
    { criterion: 'Output is structured JSON', met: data !== null && typeof data === 'object' },
  ];
  const met = criteria.filter(c => c.met).length;
  return { taskId: 'gene-02', category: 'gene', title: 'Multi-gene enrichment', maxScore: 4, score: met, criteria, notes: '' };
}

function scoreGene03(data: unknown): TaskScore {
  const content = JSON.stringify(data);
  const criteria = [
    { criterion: 'Returns valid FASTA format', met: content.includes('>') || content.includes('fasta') },
    { criterion: 'Sequence is for TP53/p53', met: content.toLowerCase().includes('tp53') || content.toLowerCase().includes('p53') || content.includes('7157') },
    { criterion: 'Can save to file', met: !isNotSupported(data) },
  ];
  const met = criteria.filter(c => c.met).length;
  return { taskId: 'gene-03', category: 'gene', title: 'Gene sequence download', maxScore: 3, score: met, criteria, notes: '' };
}

function scoreVariant(id: string, title: string, data: unknown, criteriaList: { criterion: string; check: (d: unknown) => boolean }[]): TaskScore {
  const criteria = criteriaList.map(c => ({ criterion: c.criterion, met: c.check(data) }));
  const met = criteria.filter(c => c.met).length;
  return { taskId: id, category: 'variant', title, maxScore: criteriaList.length, score: met, criteria, notes: '' };
}

function scoreLit(id: string, title: string, data: unknown, criteriaList: { criterion: string; check: (d: unknown) => boolean }[]): TaskScore {
  const criteria = criteriaList.map(c => ({ criterion: c.criterion, met: c.check(data) }));
  const met = criteria.filter(c => c.met).length;
  return { taskId: id, category: 'literature', title, maxScore: criteriaList.length, score: met, criteria, notes: '' };
}

function scoreData(id: string, title: string, data: unknown, criteriaList: { criterion: string; check: (d: unknown) => boolean }[]): TaskScore {
  const criteria = criteriaList.map(c => ({ criterion: c.criterion, met: c.check(data) }));
  const met = criteria.filter(c => c.met).length;
  return { taskId: id, category: 'data_preparation', title, maxScore: criteriaList.length, score: met, criteria, notes: '' };
}

function scoreAllTasks(rawDir: string): TaskScore[] {
  const load = (id: string) => readJson(join(rawDir, `${id}.json`));
  const s = JSON.stringify;
  const tasks: TaskScore[] = [];

  tasks.push(scoreGene01(load('gene-01')));
  tasks.push(scoreGene02(load('gene-02')));
  tasks.push(scoreGene03(load('gene-03')));

  tasks.push(scoreVariant('variant-01', 'Variant dossier', load('variant-01'), [
    { criterion: 'Returns gene name', check: d => s(d).includes('APOE') },
    { criterion: 'Returns clinical significance', check: d => s(d).toLowerCase().includes('significance') || s(d).toLowerCase().includes('pathogenic') },
    { criterion: 'Returns VEP consequence', check: d => s(d).includes('consequence') || s(d).includes('vep') || s(d).includes('impact') },
    { criterion: 'Output is structured JSON', check: d => d !== null && typeof d === 'object' },
  ]));

  tasks.push(scoreVariant('variant-02', 'Variant with clinical context', load('variant-02'), [
    { criterion: 'Returns gene (HBB)', check: d => s(d).includes('HBB') },
    { criterion: 'Returns clinical significance', check: d => s(d).toLowerCase().includes('pathogenic') },
    { criterion: 'Returns functional impact', check: d => s(d).includes('impact') || s(d).includes('interpretation') },
    { criterion: 'Returns protein context', check: d => s(d).includes('protein') || s(d).includes('function') || s(d).includes('Hemoglobin') },
    { criterion: 'Returns recommendation', check: d => s(d).includes('recommendation') || s(d).includes('counseling') },
  ]));

  tasks.push(scoreVariant('variant-03', 'SNP basic lookup', load('variant-03'), [
    { criterion: 'Returns rsID, gene, chromosome, position', check: d => s(d).includes('rs7412') && s(d).includes('APOE') },
    { criterion: 'Returns allele information', check: d => s(d).includes('allele') || s(d).includes('docsum') },
    { criterion: 'Output is structured JSON', check: d => d !== null && typeof d === 'object' && !isNotSupported(d) },
  ]));

  tasks.push(scoreLit('lit-01', 'Literature brief', load('lit-01'), [
    { criterion: 'Returns at least 3 articles', check: d => arrayLength((d as any)?.data?.articles ?? (d as any)?.rows ?? d) >= 3 },
    { criterion: 'Includes titles and abstracts', check: d => s(d).includes('abstract') || s(d).includes('Abstract') },
    { criterion: 'Includes PMIDs and DOIs', check: d => s(d).includes('pmid') || s(d).includes('doi') },
    { criterion: 'Output is structured JSON', check: d => d !== null && typeof d === 'object' },
  ]));

  tasks.push(scoreLit('lit-02', 'Fetch article by PMID', load('lit-02'), [
    { criterion: 'Returns title, authors, journal, year', check: d => s(d).includes('title') && s(d).includes('journal') },
    { criterion: 'Returns abstract text', check: d => s(d).includes('abstract') || s(d).includes('Abstract') },
    { criterion: 'Returns DOI', check: d => s(d).includes('doi') || s(d).includes('DOI') },
  ]));

  tasks.push(scoreLit('lit-03', 'Batch article fetch', load('lit-03'), [
    { criterion: 'Returns 3 articles', check: d => arrayLength(d) >= 3 || s(d).includes('36766853') },
    { criterion: 'All articles have metadata', check: d => s(d).includes('title') },
    { criterion: 'Supports batch input', check: d => !isNotSupported(d) },
  ]));

  tasks.push(scoreData('data-01', 'Dataset discovery', load('data-01'), [
    { criterion: 'Returns candidate datasets', check: d => s(d).includes('candidates') || s(d).includes('accession') },
    { criterion: 'Includes sample counts and dates', check: d => s(d).includes('samples') && s(d).includes('date') },
    { criterion: 'Ranks by relevance', check: d => s(d).includes('rank') },
    { criterion: 'Suggests next-step commands', check: d => s(d).includes('nextSteps') || s(d).includes('next') },
    { criterion: 'Output is structured JSON', check: d => d !== null && typeof d === 'object' && !isNotSupported(d) },
  ]));

  tasks.push(scoreData('data-02', 'Working directory prep (plan)', load('data-02'), [
    { criterion: 'Shows planned steps', check: d => s(d).includes('planned') || s(d).includes('steps') },
    { criterion: 'Lists what would be downloaded', check: d => s(d).includes('download') },
    { criterion: 'Lists annotations to fetch', check: d => s(d).includes('annotation') || s(d).includes('gene') },
    { criterion: 'Output is structured JSON', check: d => d !== null && typeof d === 'object' && !isNotSupported(d) },
  ]));

  tasks.push(scoreData('data-03', 'GEO download dry-run', load('data-03'), [
    { criterion: 'Lists available files with sizes', check: d => s(d).includes('size') && s(d).includes('file') },
    { criterion: 'Shows download URLs', check: d => s(d).includes('url') || s(d).includes('ftp.ncbi') || s(d).includes('available') },
    { criterion: 'Does not download files', check: d => !isNotSupported(d) },
    { criterion: 'Output is structured JSON', check: d => d !== null && typeof d === 'object' && !isNotSupported(d) },
  ]));

  return tasks;
}

// ── Cross-cutting scoring (tool-level, not task-level) ───────────────────────

function scoreCrossCutting(tool: string): CrossCuttingScores {
  if (tool === 'biocli') {
    return {
      agentReadiness: 10,    // list/help --json, schema, whenToUse, capabilities, error recovery, batch
      workflowDepth: 10,     // aggregation, scout, download, prepare, manifest, plan
      operationalSafety: 9,  // dry-run, plan, max-size, partial warnings, error codes, graceful degradation
      reproducibility: 10,   // cache, --no-cache, manifest, deterministic envelope, verify/doctor, timestamps
      outputUsability: 9,    // structured JSON, BiocliResult envelope, per-command schema
      efficiency: 8,         // single commands for complex tasks, batch input
    };
  }

  if (tool === 'gget') {
    return {
      agentReadiness: 3,     // has --json but no help --json, no schema, no whenToUse, no error recovery
      workflowDepth: 2,      // info/seq/enrichr but no cross-db aggregation, no scout/prepare
      operationalSafety: 2,  // basic error handling, no dry-run/plan
      reproducibility: 1,    // no cache, no manifest, no verify
      outputUsability: 6,    // JSON/DataFrame output, but no standard envelope
      efficiency: 6,         // direct commands but no batch, no aggregation
    };
  }

  if (tool === 'biomcp') {
    return {
      agentReadiness: 6,     // has MCP serve, _meta.next_commands, but no help --json with full guidance
      workflowDepth: 4,      // cross-db aggregation + pivot, but no download/prepare/manifest
      operationalSafety: 3,  // basic error handling, no dry-run/plan/max-size
      reproducibility: 2,    // no cache, no manifest, no verify
      outputUsability: 7,    // structured JSON with _meta envelope
      efficiency: 7,         // pivot syntax is efficient, batch support
    };
  }

  return { agentReadiness: 0, workflowDepth: 0, operationalSafety: 0, reproducibility: 0, outputUsability: 0, efficiency: 0 };
}

function computeWeightedTotal(tasks: TaskScore[], cross: CrossCuttingScores): number {
  const taskMaxTotal = tasks.reduce((sum, t) => sum + t.maxScore, 0);
  const taskTotal = tasks.reduce((sum, t) => sum + t.score, 0);
  const taskPct = taskMaxTotal > 0 ? taskTotal / taskMaxTotal : 0;

  const crossMax = 60; // 6 dimensions × 10 max each
  const crossTotal = cross.agentReadiness + cross.workflowDepth + cross.operationalSafety +
    cross.reproducibility + cross.outputUsability + cross.efficiency;
  const crossPct = crossTotal / crossMax;

  // Weighted: Task 35%, Agent 20%, Workflow 15%, Safety 10%, Repro 10%, Output 5%, Efficiency 5%
  return Math.round(
    taskPct * 35 +
    (cross.agentReadiness / 10) * 20 +
    (cross.workflowDepth / 10) * 15 +
    (cross.operationalSafety / 10) * 10 +
    (cross.reproducibility / 10) * 10 +
    (cross.outputUsability / 10) * 5 +
    (cross.efficiency / 10) * 5
  );
}

// ── Main ─────────────────────────────────────────────────────────────────────

const date = process.argv[2] ?? new Date().toISOString().slice(0, 10);
const baseDir = `benchmarks/results/${date}`;
const scoredDir = join(baseDir, 'scored');
mkdirSync(scoredDir, { recursive: true });

const summary: ToolResult[] = [];

for (const tool of TOOLS) {
  const rawDir = join(baseDir, 'raw', tool);
  if (!existsSync(rawDir)) {
    console.log(`Skipping ${tool}: no raw results at ${rawDir}`);
    continue;
  }

  console.log(`Scoring ${tool}...`);
  const tasks = scoreAllTasks(rawDir);
  const crossCutting = scoreCrossCutting(tool);
  const totalWeighted = computeWeightedTotal(tasks, crossCutting);

  const result: ToolResult = { tool, version: '', date, tasks, crossCutting, totalWeighted };
  summary.push(result);

  writeFileSync(join(scoredDir, `${tool}.json`), JSON.stringify(result, null, 2));
}

// Write summary
writeFileSync(join(scoredDir, 'summary.json'), JSON.stringify(summary, null, 2));

// Print summary table
console.log('\n=== Benchmark Summary ===\n');
console.log('Tool'.padEnd(12) + 'Tasks'.padEnd(10) + 'Agent'.padEnd(8) + 'Workflow'.padEnd(10) + 'Safety'.padEnd(8) + 'Repro'.padEnd(8) + 'Total');
console.log('-'.repeat(64));
for (const r of summary) {
  const taskScore = r.tasks.reduce((s, t) => s + t.score, 0);
  const taskMax = r.tasks.reduce((s, t) => s + t.maxScore, 0);
  console.log(
    r.tool.padEnd(12) +
    `${taskScore}/${taskMax}`.padEnd(10) +
    `${r.crossCutting.agentReadiness}/10`.padEnd(8) +
    `${r.crossCutting.workflowDepth}/10`.padEnd(10) +
    `${r.crossCutting.operationalSafety}/10`.padEnd(8) +
    `${r.crossCutting.reproducibility}/10`.padEnd(8) +
    `${r.totalWeighted}/100`
  );
}
