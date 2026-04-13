# 004: Batch/Pipeline Engineering Backlog v0.1

## Purpose

This backlog turns [003-batch-pipeline-prd.md](/Volumes/KINGSTON/work/research/biocli/ncbicli/docs/decisions/003-batch-pipeline-prd.md) into an execution plan that can be converted into issues, milestones, and implementation PRs.

The goal is not to add one more batch flag to one more command. The goal is to build a shared runtime for batch biological workflows and then attach the highest-value aggregate commands to it.

## Delivery Strategy

Recommended delivery model:

1. Build shared infrastructure first
2. Attach one command end-to-end as the reference implementation
3. Attach the next two hero commands with minimal UX drift
4. Add recovery and benchmarking after the shared runtime is stable

Recommended reference command:

- `aggregate gene-profile`

Reason:

- High-value and already mature
- Uses multiple backends and progress reporting already
- Easier to benchmark than tumor-specific workflows

## Milestones

### M1: Shared Batch Runtime

Outcome:

- A shared batch engine exists
- One aggregate command runs with file/stdin input, concurrency, progress, and JSONL output

### M2: Hero Workflow Coverage

Outcome:

- `gene-profile`, `gene-dossier`, `drug-target`, and `tumor-gene-dossier` all support the same batch contract

### M3: Recovery And Durable Output

Outcome:

- Runs can resume
- Failures are structured
- Output directories are suitable for downstream pipelines

### M4: Product Proof

Outcome:

- Benchmarks prove batch/pipeline value using execution metrics instead of single-answer quality

## Backlog

### BP-001 Shared Batch Contract

Priority: `P0`

Goal:

- Define one canonical batch CLI contract across supported commands

Deliverables:

- Supported flags:
- `--input <file|->`
- `--input-file <file>` as alias or preferred spelling
- `--input-format text|tsv|csv|jsonl`
- `--key <field>`
- `--concurrency <n>`
- `--outdir <dir>`
- `--jsonl`
- `--resume`
- `--fail-fast`
- `--max-errors <n>`
- `--retries <n>`
- `--timeout <sec>`
- One documented behavioral contract for:
- positional vs batch input precedence
- output locations
- exit codes under partial failure

Suggested file touch points:

- [commander-adapter.ts](/Volumes/KINGSTON/work/research/biocli/ncbicli/src/commander-adapter.ts)
- [batch.ts](/Volumes/KINGSTON/work/research/biocli/ncbicli/src/batch.ts)
- [errors.ts](/Volumes/KINGSTON/work/research/biocli/ncbicli/src/errors.ts)
- [README.md](/Volumes/KINGSTON/work/research/biocli/ncbicli/README.md)

Definition of done:

- One command help page shows the final batch contract
- Contract is documented once, not separately per command

### BP-002 Shared Batch Runner

Priority: `P0`

Depends on:

- `BP-001`

Goal:

- Build one shared runtime that fan-outs work with bounded concurrency and emits structured per-item results

Deliverables:

- Batch runner module
- Input normalization into a common item stream
- Bounded concurrency execution
- Per-item success/failure capture
- Run summary accumulation
- Hooks for progress reporting

Suggested file touch points:

- New: `src/batch-runner.ts`
- [batch.ts](/Volumes/KINGSTON/work/research/biocli/ncbicli/src/batch.ts)
- [utils.ts](/Volumes/KINGSTON/work/research/biocli/ncbicli/src/utils.ts)
- [progress.ts](/Volumes/KINGSTON/work/research/biocli/ncbicli/src/progress.ts)

Definition of done:

- A command implementation can hand the runner an array of normalized inputs plus an async item executor
- Runner returns a structured run summary and item-level outcomes

### BP-003 Output Directory Contract

Priority: `P0`

Depends on:

- `BP-002`

Goal:

- Standardize durable batch artifacts for downstream use

Deliverables:

- Run directory structure:
- `manifest.json`
- `summary.json`
- `results.jsonl`
- `failures.jsonl`
- `summary.csv`
- Artifact writer utilities
- Stable run metadata schema

Suggested file touch points:

- New: `src/batch-output.ts`
- New: `src/batch-types.ts`
- [types.ts](/Volumes/KINGSTON/work/research/biocli/ncbicli/src/types.ts)
- [schema.ts](/Volumes/KINGSTON/work/research/biocli/ncbicli/src/schema.ts)

Definition of done:

- A batch-enabled command can produce a run directory without command-specific file-writing code
- `results.jsonl` and `failures.jsonl` are append-safe for long runs

### BP-004 Structured Failure Model

Priority: `P0`

Depends on:

- `BP-002`
- `BP-003`

Goal:

- Make failures machine-consumable and resumable

Deliverables:

- Failure record schema with:
- `input`
- `command`
- `errorCode`
- `message`
- `retryable`
- `source`
- `attempts`
- `timestamp`
- Failure classification helper
- Mapping from existing `CliError` family into batch failure records

Suggested file touch points:

- New: `src/batch-failures.ts`
- [errors.ts](/Volumes/KINGSTON/work/research/biocli/ncbicli/src/errors.ts)
- [execution.ts](/Volumes/KINGSTON/work/research/biocli/ncbicli/src/execution.ts)

Definition of done:

- Partial failures no longer require stderr scraping to interpret
- Downstream code can tell retryable from hard failures

### BP-005 Batch Progress Runtime

Priority: `P0`

Depends on:

- `BP-002`

Goal:

- Add run-level progress on top of current task-level progress messages

Deliverables:

- Run-level progress events:
- total
- completed
- failed
- in-flight
- ETA or rate when available
- Integrate with existing `reportProgress()` flow without breaking current aggregate progress messages

Suggested file touch points:

- [progress.ts](/Volumes/KINGSTON/work/research/biocli/ncbicli/src/progress.ts)
- [commander-adapter.ts](/Volumes/KINGSTON/work/research/biocli/ncbicli/src/commander-adapter.ts)
- New: `src/batch-progress.ts`

Definition of done:

- Batch runs visibly advance even if per-item work is slow
- Existing single-item progress output still works

### BP-006 Reference Adoption: `aggregate gene-profile`

Priority: `P0`

Depends on:

- `BP-001` through `BP-005`

Goal:

- Make `aggregate gene-profile` the first fully batch-native hero command

Deliverables:

- Support batch input
- Support batch output directory
- Support JSONL success output
- Support structured failures
- Support bounded concurrency

Suggested file touch points:

- [gene-profile.ts](/Volumes/KINGSTON/work/research/biocli/ncbicli/src/clis/aggregate/gene-profile.ts)
- Tests in `src/clis/aggregate/gene-profile*.test.ts`
- Smoke coverage in `tests/smoke/`

Definition of done:

- `100` genes can be processed from file or stdin
- Successes and failures are both written to disk
- Help output documents batch mode clearly

### BP-007 Hero Adoption: `aggregate gene-dossier`

Priority: `P1`

Depends on:

- `BP-006`

Goal:

- Extend the batch contract to richer gene-level output with literature and clinical sections

Suggested file touch points:

- [gene-dossier.ts](/Volumes/KINGSTON/work/research/biocli/ncbicli/src/clis/aggregate/gene-dossier.ts)
- Related tests under `src/clis/aggregate/`

Definition of done:

- Batch gene dossiers can be generated with the same runner and output contract as `gene-profile`

### BP-008 Hero Adoption: `aggregate drug-target`

Priority: `P1`

Depends on:

- `BP-006`

Goal:

- Support batch target scans with shared runtime semantics

Specific concerns:

- Respect Open Targets and GDSC runtime cost
- Prevent accidental unbounded fan-out
- Keep output columns stable despite nested ranking and sensitivity data

Suggested file touch points:

- [drug-target.ts](/Volumes/KINGSTON/work/research/biocli/ncbicli/src/clis/aggregate/drug-target.ts)
- [opentargets.ts](/Volumes/KINGSTON/work/research/biocli/ncbicli/src/databases/opentargets.ts)
- [gdsc.ts](/Volumes/KINGSTON/work/research/biocli/ncbicli/src/databases/gdsc.ts)

Definition of done:

- 50 to 100 genes can be scanned without custom wrapper scripts
- Result flattening exposes top candidate fields in `summary.csv`

### BP-009 Hero Adoption: `aggregate tumor-gene-dossier`

Priority: `P1`

Depends on:

- `BP-006`

Goal:

- Support cohort-level tumor gene screening in batch form

Specific concerns:

- Long per-item latency
- cBioPortal rate limits
- Co-mutation and variant sections need flattened summary fields

Suggested file touch points:

- [tumor-gene-dossier.ts](/Volumes/KINGSTON/work/research/biocli/ncbicli/src/clis/aggregate/tumor-gene-dossier.ts)
- [cbioportal.ts](/Volumes/KINGSTON/work/research/biocli/ncbicli/src/databases/cbioportal.ts)
- [common.ts](/Volumes/KINGSTON/work/research/biocli/ncbicli/src/clis/cbioportal/common.ts)

Definition of done:

- A study plus gene list can be processed end-to-end with one command
- Summary outputs expose prevalence and top co-mutation metrics

### BP-010 Batch CSV Flatteners

Priority: `P1`

Depends on:

- `BP-003`
- `BP-006`

Goal:

- Make batch outputs useful without post-processing scripts

Deliverables:

- Command-specific flattener hooks for `summary.csv`
- Optional `top_hits.csv` for commands with ranked results

Suggested first flatteners:

- `gene-profile`
- `drug-target`
- `tumor-gene-dossier`

Suggested file touch points:

- New: `src/batch-flatteners.ts`
- Per-command mapping hooks in corresponding aggregate command files

Definition of done:

- Users can sort/filter high-value fields in spreadsheet tools immediately

### BP-011 Batch Methods Export

Priority: `P1`

Depends on:

- `BP-003`

Goal:

- Generate run-level `methods.md` or `methods.txt` for batch outputs

Deliverables:

- Aggregate per-item provenance into run-level methods text
- State command, input scope, runtime, source backends, releases when available

Suggested file touch points:

- [methods.ts](/Volumes/KINGSTON/work/research/biocli/ncbicli/src/methods.ts)
- New: `src/batch-methods.ts`

Definition of done:

- A batch run can produce a methods artifact without manual stitching

### BP-012 Resume And Checkpointing

Priority: `P2`

Depends on:

- `BP-003`
- `BP-004`

Goal:

- Resume interrupted runs without redoing completed items

Deliverables:

- Checkpoint reader over `results.jsonl` and `failures.jsonl`
- Skip already completed items
- Optional retry-only-failures mode

Suggested file touch points:

- New: `src/batch-resume.ts`
- `src/batch-runner.ts`
- `src/batch-output.ts`

Definition of done:

- A killed run can resume from disk with no duplicate success writes

### BP-013 Retry Policy And Backoff

Priority: `P2`

Depends on:

- `BP-004`
- `BP-012`

Goal:

- Standardize retry policy for flaky upstreams

Deliverables:

- Per-backend retry defaults
- Retry budget and backoff
- Retryability classification surfaced in failure records

Suggested file touch points:

- [execution.ts](/Volumes/KINGSTON/work/research/biocli/ncbicli/src/execution.ts)
- Database adapters under `src/databases/`

Definition of done:

- Transient errors are retried without making failures opaque

### BP-014 Snapshot And Cache Awareness In Batch Runs

Priority: `P2`

Depends on:

- `BP-008`
- `BP-012`

Goal:

- Make batch runtime aware of local datasets and cache reuse

Deliverables:

- `skip cached`
- `force refresh`
- Run metadata noting cache hits and snapshot usage

Suggested file touch points:

- [gdsc.ts](/Volumes/KINGSTON/work/research/biocli/ncbicli/src/datasets/gdsc.ts)
- Existing cache-related utilities
- `manifest.json` generation path

Definition of done:

- Users can choose speed vs freshness explicitly in batch runs

### BP-015 Batch Benchmark Harness

Priority: `P3`

Depends on:

- `BP-006`
- `BP-008`
- `BP-012`

Goal:

- Prove product value with execution metrics

Deliverables:

- Benchmark cases:
- `100 genes -> gene-profile`
- `100 genes -> drug-target`
- `20 tumor genes -> tumor-gene-dossier`
- interruption + resume
- flaky network partial failure
- Metrics:
- completion rate
- throughput
- recovery rate
- downstream parse success rate

Suggested file touch points:

- [benchmarks/README.md](/Volumes/KINGSTON/work/research/biocli/ncbicli/benchmarks/README.md)
- New benchmark scenario files under `benchmarks/`

Definition of done:

- Product claims about agent enhancement are backed by repeatable runs

## Suggested Implementation Order

### Wave 1

- `BP-001 Shared Batch Contract`
- `BP-002 Shared Batch Runner`
- `BP-003 Output Directory Contract`
- `BP-004 Structured Failure Model`
- `BP-005 Batch Progress Runtime`

### Wave 2

- `BP-006 Reference Adoption: aggregate gene-profile`
- `BP-010 Batch CSV Flatteners`
- `BP-011 Batch Methods Export`

### Wave 3

- `BP-007 aggregate gene-dossier`
- `BP-008 aggregate drug-target`
- `BP-009 aggregate tumor-gene-dossier`

### Wave 4

- `BP-012 Resume And Checkpointing`
- `BP-013 Retry Policy And Backoff`
- `BP-014 Snapshot And Cache Awareness In Batch Runs`

### Wave 5

- `BP-015 Batch Benchmark Harness`

## Suggested PR Boundaries

Recommended PR slicing:

1. Shared contract and batch runner skeleton
2. Output artifacts and failure schema
3. Progress runtime
4. `gene-profile` adoption
5. Flatteners and methods export
6. `drug-target` adoption
7. `tumor-gene-dossier` adoption
8. Resume and retries
9. Benchmarks

Do not combine all hero commands into one PR. The shared runtime needs to stabilize first.

## Open Decisions

These need explicit product/engineering decisions before implementation locks in:

1. Whether `--input-file` should replace `--input`, or remain an alias
2. Whether partial-failure runs should exit non-zero by default
3. Whether `summary.csv` is required for every batch-enabled command or only hero workflows
4. Whether run directories should be command-generated by default when `--outdir` is omitted
5. Whether `compare-genes` needs a separate list-of-lists batch abstraction later
