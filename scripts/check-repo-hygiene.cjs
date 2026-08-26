/**
 * Guard the publishable Git surface against regenerable benchmark runtime
 * homes, oversized benchmark payloads, and machine-local Markdown links.
 */
const { execFileSync } = require('node:child_process');
const { existsSync, readFileSync, statSync } = require('node:fs');

const MAX_BENCHMARK_RESULT_BYTES = 10 * 1024 * 1024;
const MACHINE_LOCAL_MARKERS = [
  '/Volumes/KINGSTON/work/',
  'file:///Volumes/',
];

// Include staged/tracked files and non-ignored untracked candidates. This makes
// the local pre-commit result match what CI will inspect after a commit.
const publishable = execFileSync(
  'git',
  ['ls-files', '-z', '--cached', '--others', '--exclude-standard'],
  { encoding: 'utf8' },
)
  .split('\0')
  .filter(Boolean);

const violations = [];
let checkedFiles = 0;

for (const file of publishable) {
  // A removed tracked file is an intended deletion in the current worktree;
  // CI validates the post-commit tree where it no longer appears in ls-files.
  if (!existsSync(file)) continue;
  checkedFiles += 1;

  const normalized = file.replaceAll('\\', '/');
  if (
    normalized.startsWith('benchmarks/pipeline/results/')
    && (
      normalized.includes('/.cache-home/')
      || /\/\.home-[^/]+\//.test(normalized)
      || normalized.includes('/.biocli/')
    )
  ) {
    violations.push(`${normalized}: benchmark runtime HOME/cache content must live under .work/`);
  }

  if (normalized.startsWith('benchmarks/pipeline/results/')) {
    const size = statSync(file).size;
    if (size > MAX_BENCHMARK_RESULT_BYTES) {
      violations.push(`${normalized}: tracked benchmark result is ${(size / 1024 / 1024).toFixed(1)} MiB (limit 10 MiB)`);
    }
  }

  if (normalized.endsWith('.md')) {
    const body = readFileSync(file, 'utf8');
    for (const marker of MACHINE_LOCAL_MARKERS) {
      if (body.includes(marker)) {
        violations.push(`${normalized}: contains machine-local path marker ${marker}`);
      }
    }
  }
}

if (violations.length > 0) {
  console.error(`Repository hygiene failed with ${violations.length} violation(s):`);
  for (const violation of violations) console.error(`- ${violation}`);
  process.exit(1);
}

console.log(`Repository hygiene passed (${checkedFiles} tracked or publishable untracked files checked).`);
