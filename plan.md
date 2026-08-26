# biocli optimization plan

Last updated: 2026-08-26

## Current state

- Release target: `v0.9.0`; the minor bump follows `RELEASE_CHECKLIST.md`
  because `gene-profile.agentSummary.selectionBasis` is a new required agent
  contract field.
- Baseline: `v0.8.1` on `main` at `deaf790`; npm `latest` was still `0.7.1` at
  the pre-release check on 2026-08-26.
- Round 4 customer-trust safeguards are implemented and locally verified.
  External publication is now explicitly authorized and follows the repository
  release checklist.

## Working agreement

- Scope: this repository root only.
- One writer at a time. Review agents are read-only on the deliverable and
  write only their own audit notes.
- Do not move or rewrite the public `v0.8.0` or `v0.8.1` tags or releases.
- `opencli/` and the frozen public benchmark bundles outside this repository are reference-only.

## Round 4: customer-path trust safeguards (complete locally)

A clean customer-path exercise against `v0.8.1` found four cases where valid
JSON could still invite a scientifically wrong or operationally surprising
interpretation. This round fixes those cases without removing existing output
fields.

| # | Finding | Severity | Status |
|---|---|---|---|
| 1 | The cBioPortal candidate list stored bare Entrez IDs; `4018` was commented as `LRP1B` although it resolves to `LPA`, allowing a false context label | P0 | Implemented; 172 identities validated against NCBI Gene |
| 2 | `workflow-prepare --skip-download` accepted a regex-shaped but nonexistent accession, created files, and reported complete | P0 | Implemented; exact GEO/SRA validation now precedes all writes |
| 3 | `gene-profile` described first-in-upstream-order KEGG entries as “top” findings without a ranking basis | P1 | Implemented; semantics and `selectionBasis` are explicit |
| 4 | A clean `drug-target` run silently downloaded and indexed large GDSC workbooks | P1 | Implemented; default is local-only and missing data degrades visibly |

Acceptance targets:

- `LPA/4018` is not context-labelled; all 172 reference identities pass the
  opt-in NCBI validator and offline regression.
- Invalid GEO/SRA accessions leave the requested output path untouched; valid
  accessions produce `metadata/dataset.json`.
- KEGG pathway/disease previews state upstream ordering; STRING partners are
  deterministically sorted by combined score.
- `aggregate drug-target` never downloads GDSC unless the user explicitly runs
  `gdsc prewarm`, `gdsc refresh`, or batch `--force-refresh`.

## Round 3: post-0.8.0 review findings (complete)

An independent review of `0.8.0` confirmed the release is sound but found four
gaps where the shipped behaviour did not fully match what the docs and commit
messages claimed. All four were reproduced locally before being fixed.

| # | Finding | Severity | Status |
|---|---|---|---|
| 1 | A 429 retry did not consume a rate-limit slot, so two requests could land inside a one-request window | P1 | Fixed |
| 2 | `--strict` only checked degraded items, so a run with hard failures passed the coverage gate | P1 | Fixed |
| 3 | A failed `--retry-degraded` attempt was erased from `failures.jsonl` by the retained earlier success | P2 | Fixed |
| 4 | `-f plain` / table / card still rendered nested fields as `[object Object]` | P2 | Fixed |

Notes carried forward:

- `penalize()` originally cleared the rate window. That handed budget back and
  let a burst through the moment the cooldown expired. The cooldown adds delay;
  the window enforces the rate. It no longer clears.
- `failures.jsonl` is the audit log of attempts that failed. `summary.json`
  `failed` counts items left with no usable result. A retained partial result
  means the two can differ.
- Root cause of the whole class: concurrency crossed with failure state had no
  regression coverage. Each fix landed with one.

## Round 2 history: 0.7.1 baseline (complete)

The section below records the `0.7.1` baseline and the seven-step pass that
produced `0.8.0`. It is history; do not read it as current state.

- Writer at the time: Codex primary agent.
- Baseline at the time: local `main` at `5cd5d24` (`v0.7.1`).
- Existing uncommitted work was preserved; no commit or history rewrite was
  performed during that pass.

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
- 2026-08-26: At the round 2 baseline, release/documentation truth was `0.7.1`, 65 commands, 14 documented agent-optimized workflow commands, 11 registered backends, and two local reference datasets. The generated manifest had 16 entries whose internal `database` was `aggregate`; `px dataset` and `px files` were the two multi-backend adapters outside the 14-command workflow table.
- 2026-08-26: Undici is constrained to `^6.28.0` to preserve Node >=20 support. `js-yaml` was raised to patched `^4.3.1`. `npm audit` still reports 13 findings (2 low, 4 moderate, 7 high, 0 critical); the remaining direct findings are `fast-xml-parser` (major-version migration required) and `xlsx` (no npm fix available).
- 2026-08-26: Agent A/B scoring uses `agent-ab-v1` (`0-2` across five operational dimensions). Accuracy, source, and safety are separate reviews; the current 24-row scored set marks them not completed.
- 2026-08-26: Two immutable repeat-001 raw contract failures are SHA-256 pinned as known historical failures. Validator success means no additional core failures were found.
- 2026-08-26: Ten historical pipeline runtime-home directories were moved, without deletion, to ignored `.work/legacy-benchmark-cache/2026-04-13/`. Retained pipeline results are about 20 MB; the recoverable archive is about 263 MB. Git history was not rewritten.
- 2026-08-26: cBioPortal co-mutation candidates now come from
  `biocli-cancer-gene-context-v1`, a unique symbol/Entrez pair reference. The
  legacy `known_driver` label is compatibility-only and its note states that
  membership is a retrieval heuristic rather than driver evidence.
- 2026-08-26: `workflow-prepare` validates exact GEO/SRA identity before any
  filesystem write and stores the source record in `metadata/dataset.json`.
- 2026-08-26: `gene-profile` retains its stable `top*` field names but exposes
  `selectionBasis`; only STRING partners receive an explicit score ordering.
- 2026-08-26: GDSC acquisition is opt-in. `drug-target` reads only a complete
  local snapshot and otherwise returns partial completeness with an actionable
  `gdsc prewarm` warning.

## Round 4 verification

| Check | Result |
|---|---|
| `npm run validate:cancer-gene-context` | Passed; 172/172 identities matched current NCBI Gene symbols |
| Focused regressions | Passed: cancer context 16, dataset/workflow validation 4, gene-profile 4, drug-target 12, GDSC 3 |
| `npm ci` | Passed from the lockfile; 187 packages installed with no engine mismatch |
| `npm run typecheck` | Passed |
| `npm run test:all` | 98 files, 549 tests passed |
| `npm run build` | Passed; generated 65-command manifest including `metadata/dataset.json` artifact metadata |
| `npm run smoke:core` | Six core smoke checks passed |
| `npm run smoke:live` | Seven live upstream checks passed |
| `npm run verify:conda` | Passed |
| `npm run check:repo-hygiene` | Passed across 646 tracked or publishable untracked files |
| `npm run bench:agent-ab:validate` | Passed; two hash-pinned historical failures and strict warnings remain visible |
| `npm audit --json` | 13 findings reviewed: 2 low, 4 moderate, 7 high, 0 critical; unchanged baseline, no force fix |
| `npm pack` | Passed; `0.9.0` tarball is 281,688 bytes compressed with 293 entries |
| Clean tarball install | Passed; version `0.9.0`, doctor 17/17, core smoke 6/6 |
| Local conda build | Not run: default `/tmp` cache has 7.3 GiB free, below the helper's 8 GiB safety gate |
| `git fsck --full` | Passed; only two unreachable dangling trees reported after AppleDouble cleanup |
| `git diff --check` | Passed |

Live customer-path smoke evidence:

- clean-cache `drug-target EGFR --disease lung` completed in about 3.4 seconds
  with Open Targets only, visible partial completeness, and no GDSC directory;
- nonexistent `GSE999999999` returned `NOT_FOUND` and created no output path;
- valid `GSE315149 --skip-download` resolved NCBI UID `200315149`, reported six
  samples, and wrote source-backed GEO metadata.

## Historical round 2 verification

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
