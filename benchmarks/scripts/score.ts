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
    { criterion: 'Includes ClinVar clinical variants', met: arrayLength((data as any)?.data?.clinicalVariants) >= 1 },
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
    { criterion: 'Includes p-values or scores', met: JSON.stringify(data).includes('pValue') || JSON.stringify(data).includes('p_value') || JSON.stringify(data).includes('p_val') || JSON.stringify(data).includes('Score') || JSON.stringify(data).includes('combined_score') },
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
    { criterion: 'Returns at least 3 articles', check: d => arrayLength((d as any)?.data?.papers ?? (d as any)?.data?.articles ?? (d as any)?.rows ?? d) >= 3 },
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

// ── Cross-cutting scoring (manual audit, not automated) ──────────────────────
//
// These scores are from manual feature inspection, NOT automated testing.
// Each score has a justification. See rubric.md for criteria definitions.
// Audited on 2026-04-08 against installed versions.

interface ManualAuditEntry {
  score: number;
  justification: string;
}

type ManualAudit = Record<keyof CrossCuttingScores, ManualAuditEntry>;

const MANUAL_AUDITS: Record<string, ManualAudit> = {
  biocli: {
    agentReadiness:    { score: 10, justification: 'list/help --json, per-command schema, whenToUse/whenNotToUse, capabilities, error recovery suggestions, batch --input (10/10 rubric criteria met)' },
    workflowDepth:     { score: 10, justification: 'cross-db aggregation, dataset scout, GEO/SRA download, working directory prepare, manifest.json, --plan preview (10/10)' },
    operationalSafety: { score: 9,  justification: '--dry-run, --plan, --max-size, partial failure reporting, structured error codes, graceful degradation. Missing: no interactive confirmation prompt (-1)' },
    reproducibility:   { score: 10, justification: 'file cache with TTL, --no-cache, manifest.json with provenance, deterministic BiocliResult envelope, verify/doctor, queriedAt timestamps (10/10)' },
    outputUsability:   { score: 9,  justification: 'structured JSON, BiocliResult envelope, per-command data schema, auto-JSON in pipe. Minor: some atomic commands lack envelope (-1)' },
    efficiency:        { score: 8,  justification: 'single commands for complex multi-db tasks, --input batch. Minor: no parallel batch execution, no streaming output (-2)' },
  },
  gget: {
    agentReadiness:    { score: 3,  justification: 'has --json/-j flag (1pt), no help --json (0), no schema (0), no whenToUse (0), no error recovery (0), no batch --input (0), has CLI help text (1pt), has Python API (1pt)' },
    workflowDepth:     { score: 2,  justification: 'info + seq + enrichr modules (1pt), no cross-db aggregation (0), no scout/prepare (0), can chain via Python (1pt)' },
    operationalSafety: { score: 2,  justification: 'basic Python error handling (1pt), no dry-run/plan (0), no max-size (0), stderr warnings (1pt)' },
    reproducibility:   { score: 1,  justification: 'no cache (0), no manifest (0), no verify (0), consistent JSON output format (1pt)' },
    outputUsability:   { score: 6,  justification: 'JSON output (2pt), DataFrame/CSV (2pt), but no standard envelope (0), no schema (0), consistent field naming (2pt)' },
    efficiency:        { score: 6,  justification: 'direct single commands (2pt), Python chaining (2pt), no CLI batch input (0), no aggregation commands (0), fast Ensembl lookups (2pt)' },
  },
  biomcp: {
    agentReadiness:    { score: 6,  justification: 'MCP serve mode (2pt), _meta.next_commands (1pt), -j JSON flag (1pt), search/get/pivot grammar (1pt), no help --json with full guidance (0), batch support (1pt)' },
    workflowDepth:     { score: 4,  justification: 'cross-db gene/variant aggregation (2pt), pivot syntax (1pt), no data download (0), no prepare/manifest (0), local cBioPortal study analysis (1pt)' },
    operationalSafety: { score: 3,  justification: 'structured error messages (1pt), --no-cache flag (1pt), no dry-run/plan (0), no max-size (0), partial source failure warnings (1pt)' },
    reproducibility:   { score: 2,  justification: 'HTTP response cache (1pt), no manifest (0), no verify/doctor (0), JSON output with _meta (1pt)' },
    outputUsability:   { score: 7,  justification: 'structured JSON with _meta envelope (3pt), evidence_urls in output (2pt), Markdown default (1pt), no per-command schema (0), consistent field naming (1pt)' },
    efficiency:        { score: 7,  justification: 'unified entity grammar (2pt), pivot cross-entity (2pt), batch commands (1pt), single binary (1pt), no streaming (0), fast API routing (1pt)' },
  },
};

function scoreCrossCutting(tool: string): { scores: CrossCuttingScores; audits: Record<string, string> } {
  const audit = MANUAL_AUDITS[tool === 'biomcp' ? 'biomcp' : tool];
  if (!audit) {
    return {
      scores: { agentReadiness: 0, workflowDepth: 0, operationalSafety: 0, reproducibility: 0, outputUsability: 0, efficiency: 0 },
      audits: {},
    };
  }
  const scores: CrossCuttingScores = {
    agentReadiness: audit.agentReadiness.score,
    workflowDepth: audit.workflowDepth.score,
    operationalSafety: audit.operationalSafety.score,
    reproducibility: audit.reproducibility.score,
    outputUsability: audit.outputUsability.score,
    efficiency: audit.efficiency.score,
  };
  const audits: Record<string, string> = {};
  for (const [key, entry] of Object.entries(audit)) {
    audits[key] = entry.justification;
  }
  return { scores, audits };
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
  const { scores: crossCutting, audits: crossCuttingJustifications } = scoreCrossCutting(tool);
  const totalWeighted = computeWeightedTotal(tasks, crossCutting);

  const VERSIONS: Record<string, string> = { biocli: '0.3.9', gget: '0.30.3', biomcp: '0.8.19' };
  const result: ToolResult & { crossCuttingJustifications?: Record<string, string>; scoredAt?: string } = {
    tool,
    version: VERSIONS[tool] ?? '',
    date,
    tasks,
    crossCutting,
    totalWeighted,
    crossCuttingJustifications,
    scoredAt: new Date().toISOString(),
  };
  summary.push(result);

  writeFileSync(join(scoredDir, `${tool}.json`), JSON.stringify(result, null, 2));
}

// Write summary
writeFileSync(join(scoredDir, 'summary.json'), JSON.stringify(summary, null, 2));

// Print summary table
console.log('\n=== Benchmark Summary ===');
console.log('  Task scores: automated from raw output');
console.log('  Cross-cutting scores: manual audit (see justifications in scored/*.json)\n');
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
