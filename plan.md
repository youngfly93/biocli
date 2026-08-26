# biocli optimization plan

Last updated: 2026-08-26

## Working agreement

- Scope: this repository root only.
- Writer: Codex primary agent; no parallel writers or sub-agents are active.
- Baseline: local `main` at `5cd5d24` (`v0.7.1`, matching the current local `origin/main` ref).
- Existing uncommitted work is preserved. No Git commit, stash, reset, checkout, or broad unrelated cleanup is authorized by this plan.
- `opencli/` and the frozen public benchmark bundles outside this repository are reference-only.

## Pre-existing worktree baseline

The following paths were already modified or untracked before this optimization pass. Treat them as in-progress work and edit only when the corresponding plan step requires it.

### Modified

- `README.md`
- `benchmarks/agent-ab/README.md`
- `benchmarks/agent-ab/prompts.md`
- `docs/release-template.md`
- `package.json`
- `packaging/conda/recipe/meta.yaml`
- `scripts/clean-apple-double.cjs`
- `src/clis/aggregate/drug-target.test.ts`
- `src/clis/aggregate/drug-target.ts`
- `src/databases/cbioportal.ts`
- `src/databases/opentargets.ts`
- `src/doctor.ts`

### Untracked

- `benchmarks/agent-ab/first-run.execution.md`
- `benchmarks/agent-ab/first-run.prompts.md`
- `benchmarks/agent-ab/first-run.tasks.yaml`
- `benchmarks/agent-ab/results/2026-04-15/`
- `benchmarks/agent-ab/scorecard.template.csv`
- `docs/benchmarks/agent-ab-proof-block.md`
- `docs/decisions/007-agent-ab-evaluation-prd.md`
- `docs/decisions/008-agent-ab-evaluation-backlog.md`
- `scripts/validate-agent-ab-results.cjs`
- `src/network-diagnostics.test.ts`
- `src/network-diagnostics.ts`

## Optimization steps

| Step | Status | Objective | Acceptance evidence |
|---|---|---|---|
| 1 | Complete | Establish a single status source and protect existing work | This plan records the baseline, ownership, scope, and verification policy |
| 2 | Complete | Derive MCP side-effect annotations from command metadata | `src/mcp-core.test.ts`: 16/16 focused tests passed |
| 3 | Complete | Version and document the `drug-target` ranking method | Typecheck passed; focused adapter tests 11/11 passed; report-limit invariance is covered |
| 4 | Complete | Consolidate duplicated batch mechanics | Typecheck passed; generic tests 2/2 and aggregate consumer tests 19/19 passed |
| 5 | Complete | Synchronize release and architecture documentation | Final unit suite 486/486, typecheck, lockfile-clean `npm ci` without engine mismatch, build, core smoke, and conda scaffold verification passed |
| 6 | Complete | Reconcile Agent A/B evaluation methodology | `agent-ab-v1` validator passed 24 score rows; two legacy failures remain hash-pinned and visible |
| 7 | Complete | Reduce benchmark repository growth risk | Repository-hygiene check passed; runtime homes were moved to ignored `.work/`, while retained datasets have checksummed snapshot metadata |

## Verification policy

- Run focused tests after each implementation step.
- Before handoff run: `npm run typecheck`, `npm run test:all`, `npm run build`, and `npm run smoke:core`.
- Live API smoke tests are opt-in because they depend on external services and network policy.
- Record any skipped or failing check with the exact reason; do not report stale coverage as current verification.

## Decision log

- 2026-08-26: Execute correctness and contract fixes before structural refactors and repository hygiene.
- 2026-08-26: Preserve the current uncommitted network diagnostics, drug-target, release, and Agent A/B work as the working baseline.
- 2026-08-26: MCP annotations now use `CliCommand.readOnly` as their source of truth; commands remain read-only by default.
- 2026-08-26: `npm ci` reported that locked `undici@8.0.2` requires Node `>=22.19.0` while the current runtime is Node `22.16.0`; dependency audit findings will be reviewed during release synchronization rather than auto-fixed.
- 2026-08-26: `drug-target` ranking is frozen as `biocli-drug-target-ranking-v1`; score components are exposed and documented.
- 2026-08-26: `--report-limit` is presentation-only. All unique Open Targets reports returned to the command are used for ranking and source counts.
- 2026-08-26: Generic CLI batch and aggregate hero batch now share `src/batch-execution.ts`; wrappers retain their existing cache-read policies and UI/error behavior.
- 2026-08-26: Release/documentation truth is `0.7.1`, 65 commands, 14 documented agent-optimized workflow commands, 11 registered backends, and two local reference datasets. The generated manifest has 16 entries whose internal `database` is `aggregate`; `px dataset` and `px files` are the two multi-backend adapters outside the 14-command workflow table.
- 2026-08-26: Undici is constrained to `^6.28.0` to preserve Node >=20 support. `js-yaml` was raised to patched `^4.3.1`. `npm audit` still reports 13 findings (2 low, 4 moderate, 7 high, 0 critical); the remaining direct findings are `fast-xml-parser` (major-version migration required) and `xlsx` (no npm fix available).
- 2026-08-26: Agent A/B scoring uses `agent-ab-v1` (`0-2` across five operational dimensions). Accuracy, source, and safety are separate reviews; the current 24-row scored set marks them not completed.
- 2026-08-26: Two immutable repeat-001 raw contract failures are SHA-256 pinned as known historical failures. Validator success means no additional core failures were found.
- 2026-08-26: Ten historical pipeline runtime-home directories were moved, without deletion, to ignored `.work/legacy-benchmark-cache/2026-04-13/`. Retained pipeline results are about 20 MB; the recoverable archive is about 263 MB. Git history was not rewritten.

## Final verification

| Check | Result |
|---|---|
| `npm run typecheck` | Passed |
| `npm run test:all` | 92 files, 486 tests passed |
| `npm run build` | Passed; generated 65-command manifest |
| `npm run smoke:core` | Six core smoke checks passed |
| `npm pack --dry-run --json` | Passed; `0.7.1` package preview is 271,442 bytes compressed |
| `npm run verify:conda` | Passed |
| `npm run check:repo-hygiene` | Passed across 634 tracked or publishable untracked files |
| `npm run bench:agent-ab:validate` | 30 raw files and 24 score rows checked; two hash-pinned historical failures and strict warnings remain visible |
| `npm audit --json` | 13 findings remain: 2 low, 4 moderate, 7 high, 0 critical |
| `git diff --check` | Passed |

Live upstream API smoke tests were not run because they are network- and service-dependent. No commit or Git-history rewrite was performed.
