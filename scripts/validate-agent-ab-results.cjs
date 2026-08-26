/**
 * Validate raw artifacts and scored sets for benchmarks/agent-ab.
 *
 * Core failures exit non-zero. Strict source-shape drift, pinned historical
 * failures, missing evidence review, and unreliable runtime values are visible
 * warnings so they cannot silently turn into public claims.
 */
const {
  existsSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
} = require('fs');
const { createHash } = require('crypto');
const path = require('path');

const RUBRIC_VERSION = 'agent-ab-v1';
const OPERATIONAL_DIMENSIONS = [
  'completion',
  'structure',
  'parseability',
  'recovery',
  'efficiency',
];
const SCORE_COLUMNS = OPERATIONAL_DIMENSIONS.map(dimension => `${dimension}_score`);
const BENCHMARK_ROOT = path.join('benchmarks', 'agent-ab');
const KNOWN_FAILURES_PATH = path.join(BENCHMARK_ROOT, 'known-core-failures.json');

const args = process.argv.slice(2);
const cleanAppleDouble = args.includes('--clean-appledouble');
const rootArg = args.find(arg => !arg.startsWith('--'));
const root = rootArg || path.join(BENCHMARK_ROOT, 'results');

function walk(dir, files = []) {
  for (const entry of readdirSync(dir).sort()) {
    const full = path.join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      walk(full, files);
      continue;
    }
    files.push(full);
  }
  return files;
}

function isObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value);
}

function isStringArray(value) {
  return Array.isArray(value) && value.every(item => typeof item === 'string');
}

function readJson(file) {
  return JSON.parse(readFileSync(file, 'utf-8'));
}

function sha256(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}

function formatRel(file) {
  return path.relative(process.cwd(), file).split(path.sep).join('/');
}

function parseCsv(raw) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;

  for (let index = 0; index < raw.length; index += 1) {
    const char = raw[index];
    if (quoted) {
      if (char === '"' && raw[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      quoted = true;
    } else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n') {
      row.push(field.replace(/\r$/, ''));
      if (row.some(value => value !== '')) rows.push(row);
      row = [];
      field = '';
    } else {
      field += char;
    }
  }

  if (quoted) throw new Error('unterminated quoted CSV field');
  if (field || row.length > 0) {
    row.push(field.replace(/\r$/, ''));
    if (row.some(value => value !== '')) rows.push(row);
  }
  return rows;
}

function readCsvObjects(file) {
  const rows = parseCsv(readFileSync(file, 'utf-8'));
  if (rows.length === 0) return { headers: [], rows: [] };
  const headers = rows[0];
  const objects = rows.slice(1).map((values, rowIndex) => ({
    rowNumber: rowIndex + 2,
    values: Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ''])),
    extraValues: values.slice(headers.length),
  }));
  return { headers, rows: objects };
}

function validateCore(obj) {
  const errors = [];
  if (!isObject(obj)) {
    errors.push('top-level JSON must be an object');
    return errors;
  }

  if (typeof obj.task_id !== 'string' || !obj.task_id.trim()) errors.push('missing non-empty task_id');
  if (obj.arm !== 'agent_with_biocli' && obj.arm !== 'agent_without_biocli') errors.push('missing valid arm');
  if (!['completed', 'partial', 'failed'].includes(obj.status)) errors.push('missing valid status');
  if (!isObject(obj.final_answer)) {
    errors.push('missing final_answer object');
  } else {
    if (typeof obj.final_answer.summary !== 'string') errors.push('missing final_answer.summary string');
    if (!('result' in obj.final_answer)) errors.push('missing final_answer.result');
  }
  if (!Array.isArray(obj.sources)) errors.push('missing sources array');
  if (!Array.isArray(obj.commands_used)) errors.push('missing commands_used array');
  if (!Array.isArray(obj.web_queries)) errors.push('missing web_queries array');
  if (!Array.isArray(obj.warnings)) errors.push('missing warnings array');
  if (!Array.isArray(obj.errors)) errors.push('missing errors array');
  if (!Array.isArray(obj.recovery_actions)) errors.push('missing recovery_actions array');
  if (!isObject(obj.runtime)) {
    errors.push('missing runtime object');
  } else {
    if (typeof obj.runtime.wall_clock_ms !== 'number') errors.push('missing runtime.wall_clock_ms number');
    if (!Number.isInteger(obj.runtime.tool_calls)) errors.push('missing runtime.tool_calls integer');
  }

  return errors;
}

function validateStrict(obj) {
  const warnings = [];
  if (!Array.isArray(obj.sources)) return warnings;

  for (const [index, source] of obj.sources.entries()) {
    if (typeof source === 'string') {
      warnings.push(`sources[${index}] is a string; preferred shape is an object with label/url/record_ids`);
      continue;
    }
    if (!isObject(source)) {
      warnings.push(`sources[${index}] is not an object`);
      continue;
    }
    if (typeof source.label !== 'string') {
      if (typeof source.source === 'string') {
        warnings.push(`sources[${index}] uses legacy field "source"; prefer "label"`);
      } else {
        warnings.push(`sources[${index}] missing label`);
      }
    }
    if ('record_ids' in source && !isStringArray(source.record_ids)) {
      warnings.push(`sources[${index}].record_ids should be an array of strings`);
    }
  }

  return warnings;
}

function validateScoredSet(scorecardFile) {
  const failures = [];
  const warnings = [];
  const scorecardRel = formatRel(scorecardFile);
  const scoredDir = path.dirname(scorecardFile);
  const manifestFile = path.join(scoredDir, 'scoring-manifest.json');
  let manifest;

  if (!existsSync(manifestFile)) {
    failures.push(`${scorecardRel}: missing scoring-manifest.json`);
  } else {
    try {
      manifest = readJson(manifestFile);
    } catch (error) {
      failures.push(`${formatRel(manifestFile)}: invalid JSON (${error instanceof Error ? error.message : String(error)})`);
    }
  }

  if (manifest) {
    if (manifest.rubricVersion !== RUBRIC_VERSION) {
      failures.push(`${formatRel(manifestFile)}: rubricVersion must be ${RUBRIC_VERSION}`);
    }
    if (JSON.stringify(manifest.operationalDimensions) !== JSON.stringify(OPERATIONAL_DIMENSIONS)) {
      failures.push(`${formatRel(manifestFile)}: operationalDimensions do not match the canonical rubric`);
    }
    if (manifest.operationalScale?.min !== 0 || manifest.operationalScale?.max !== 2) {
      failures.push(`${formatRel(manifestFile)}: operationalScale must be 0-2`);
    }
    if (manifest.scorecard !== path.basename(scorecardFile)) {
      failures.push(`${formatRel(manifestFile)}: scorecard must reference ${path.basename(scorecardFile)}`);
    }
  }

  let parsed;
  try {
    parsed = readCsvObjects(scorecardFile);
  } catch (error) {
    return {
      rows: 0,
      failures: [`${scorecardRel}: invalid CSV (${error instanceof Error ? error.message : String(error)})`],
      warnings,
    };
  }

  const requiredHeaders = [
    'run_id',
    'task_id',
    'arm',
    'status',
    ...SCORE_COLUMNS,
    'time_to_first_structured_ms',
    'time_to_final_ms',
    'recovery_needed',
    'recovery_succeeded',
    'manual_intervention_needed',
    'artifact_path',
    'transcript_path',
    'notes',
  ];
  for (const header of requiredHeaders) {
    if (!parsed.headers.includes(header)) failures.push(`${scorecardRel}: missing column ${header}`);
  }

  const seenRunIds = new Set();
  for (const row of parsed.rows) {
    const values = row.values;
    const prefix = `${scorecardRel}:${row.rowNumber}`;
    if (row.extraValues.length > 0) failures.push(`${prefix}: extra CSV values beyond the header`);
    if (!values.run_id) failures.push(`${prefix}: missing run_id`);
    if (seenRunIds.has(values.run_id)) failures.push(`${prefix}: duplicate run_id ${values.run_id}`);
    seenRunIds.add(values.run_id);
    if (!['agent_with_biocli', 'agent_without_biocli'].includes(values.arm)) failures.push(`${prefix}: invalid arm`);
    if (!['completed', 'partial', 'failed'].includes(values.status)) failures.push(`${prefix}: invalid status`);

    for (const column of SCORE_COLUMNS) {
      const score = Number(values[column]);
      if (!Number.isInteger(score) || score < 0 || score > 2) {
        failures.push(`${prefix}: ${column} must be an integer from 0 to 2`);
      }
    }
    const completionScore = Number(values.completion_score);
    if (values.status === 'failed' && completionScore !== 0) failures.push(`${prefix}: failed status requires completion_score=0`);
    if (values.status === 'partial' && completionScore > 1) failures.push(`${prefix}: partial status cannot have completion_score=2`);

    for (const column of ['time_to_first_structured_ms', 'time_to_final_ms']) {
      const value = Number(values[column]);
      if (!Number.isFinite(value) || value < 0) failures.push(`${prefix}: ${column} must be a non-negative number`);
      if (value === 0) warnings.push(`${prefix}: ${column}=0; do not interpret as measured instant execution`);
    }
    for (const column of ['recovery_needed', 'recovery_succeeded', 'manual_intervention_needed']) {
      if (!['yes', 'no'].includes(values[column])) failures.push(`${prefix}: ${column} must be yes or no`);
    }

    for (const column of ['artifact_path', 'transcript_path']) {
      if (!values[column]) {
        failures.push(`${prefix}: missing ${column}`);
        continue;
      }
      const resolved = path.resolve(BENCHMARK_ROOT, values[column]);
      if (!existsSync(resolved)) failures.push(`${prefix}: ${column} does not exist (${values[column]})`);
    }
  }

  if (manifest) {
    const review = manifest.evidenceReview;
    if (!isObject(review) || !['not_completed', 'completed'].includes(review.status)) {
      failures.push(`${formatRel(manifestFile)}: evidenceReview.status must be not_completed or completed`);
    } else if (review.status === 'not_completed') {
      warnings.push(`${formatRel(manifestFile)}: evidence review is not complete; accuracy/source/safety claims are not allowed`);
      if (review.file != null) failures.push(`${formatRel(manifestFile)}: incomplete evidence review must use file=null`);
    } else {
      if (typeof review.file !== 'string' || !review.file) {
        failures.push(`${formatRel(manifestFile)}: completed evidence review requires a file`);
      } else {
        const reviewFile = path.resolve(scoredDir, review.file);
        if (!existsSync(reviewFile)) {
          failures.push(`${formatRel(manifestFile)}: evidence review file does not exist (${review.file})`);
        } else {
          const evidence = readCsvObjects(reviewFile);
          const reviewHeaders = ['run_id', 'accuracy_review', 'source_review', 'safety_review', 'reviewer', 'notes'];
          for (const header of reviewHeaders) {
            if (!evidence.headers.includes(header)) failures.push(`${formatRel(reviewFile)}: missing column ${header}`);
          }
          const reviewedIds = new Set();
          for (const row of evidence.rows) {
            const values = row.values;
            const prefix = `${formatRel(reviewFile)}:${row.rowNumber}`;
            reviewedIds.add(values.run_id);
            if (!['pass', 'partial', 'fail', 'unreviewed'].includes(values.accuracy_review)) failures.push(`${prefix}: invalid accuracy_review`);
            if (!['pass', 'partial', 'fail', 'unreviewed'].includes(values.source_review)) failures.push(`${prefix}: invalid source_review`);
            if (!['pass', 'fail', 'not_applicable', 'unreviewed'].includes(values.safety_review)) failures.push(`${prefix}: invalid safety_review`);
            if (!values.reviewer) failures.push(`${prefix}: missing reviewer`);
          }
          for (const runId of seenRunIds) {
            if (!reviewedIds.has(runId)) failures.push(`${formatRel(reviewFile)}: missing review row for ${runId}`);
          }
        }
      }
    }
  }

  return { rows: parsed.rows.length, failures, warnings };
}

if (!existsSync(root) || !statSync(root).isDirectory()) {
  console.error(`Agent A/B validation root does not exist or is not a directory: ${root}`);
  process.exit(1);
}

const allFiles = walk(root);
const appleDoubleFiles = allFiles.filter(file => path.basename(file).startsWith('._'));
if (cleanAppleDouble) {
  for (const file of appleDoubleFiles) rmSync(file, { force: true });
}

const rawJsonFiles = allFiles.filter(file =>
  file.endsWith('.json')
  && file.includes(`${path.sep}raw${path.sep}`)
  && /^run-\d+\.json$/.test(path.basename(file))
  && !path.basename(file).startsWith('._')
);
const scorecardFiles = allFiles.filter(file =>
  path.basename(file) === 'scorecard.csv'
  && file.includes(`${path.sep}scored${path.sep}`)
);

const coreFailures = [];
const strictWarnings = [];
for (const file of rawJsonFiles) {
  let parsed;
  try {
    parsed = readJson(file);
  } catch (error) {
    coreFailures.push({ file, issues: [`invalid JSON: ${error instanceof Error ? error.message : String(error)}`] });
    continue;
  }

  const coreIssues = validateCore(parsed);
  if (coreIssues.length > 0) coreFailures.push({ file, issues: coreIssues });
  const strictIssues = validateStrict(parsed);
  if (strictIssues.length > 0) strictWarnings.push({ file, issues: strictIssues });
}

let knownFailureEntries = [];
if (existsSync(KNOWN_FAILURES_PATH)) {
  const knownManifest = readJson(KNOWN_FAILURES_PATH);
  knownFailureEntries = Array.isArray(knownManifest.failures) ? knownManifest.failures : [];
}
const knownByPath = new Map(knownFailureEntries.map(entry => [entry.path, entry]));
const pinnedCoreFailures = [];
const newCoreFailures = [];
for (const failure of coreFailures) {
  const relative = formatRel(failure.file);
  const known = knownByPath.get(relative);
  if (known && known.sha256 === sha256(failure.file)) pinnedCoreFailures.push(failure);
  else newCoreFailures.push(failure);
}

const staleKnownFailures = knownFailureEntries.filter((entry) => {
  const matched = pinnedCoreFailures.some(failure => formatRel(failure.file) === entry.path);
  return !matched;
});

const scoringFailures = [];
const scoringWarnings = [];
let scoredRows = 0;
for (const scorecard of scorecardFiles) {
  const validation = validateScoredSet(scorecard);
  scoredRows += validation.rows;
  scoringFailures.push(...validation.failures);
  scoringWarnings.push(...validation.warnings);
}

console.log(`Agent A/B validation root: ${root}`);
console.log(`Raw JSON files checked: ${rawJsonFiles.length}`);
console.log(`Scorecard files checked: ${scorecardFiles.length} (${scoredRows} row(s))`);
console.log(`AppleDouble files ${cleanAppleDouble ? 'cleaned/ignored' : 'found'}: ${appleDoubleFiles.length}`);
console.log(`Hash-pinned historical core failures: ${pinnedCoreFailures.length}`);

if (strictWarnings.length > 0) {
  console.log(`Strict warnings: ${strictWarnings.length} file(s)`);
  for (const item of strictWarnings) {
    console.log(`WARN ${formatRel(item.file)}`);
    for (const issue of item.issues) console.log(`  - ${issue}`);
  }
}

for (const item of pinnedCoreFailures) {
  console.log(`KNOWN ${formatRel(item.file)}`);
  for (const issue of item.issues) console.log(`  - ${issue}`);
}
for (const entry of staleKnownFailures) {
  console.log(`WARN stale known-failure entry: ${entry.path}`);
}
for (const warning of scoringWarnings) console.log(`WARN ${warning}`);

if (newCoreFailures.length > 0) {
  console.error(`New core validation failures: ${newCoreFailures.length} file(s)`);
  for (const item of newCoreFailures) {
    console.error(`FAIL ${formatRel(item.file)}`);
    for (const issue of item.issues) console.error(`  - ${issue}`);
  }
}
if (scoringFailures.length > 0) {
  console.error(`Scoring validation failures: ${scoringFailures.length}`);
  for (const issue of scoringFailures) console.error(`FAIL ${issue}`);
}

if (newCoreFailures.length > 0 || scoringFailures.length > 0) process.exit(1);
console.log('Core and scoring validation passed; hash-pinned historical failures remain visible.');
