# 003: Batch/Pipeline PRD v0.1

## Product Definition

`biocli`'s next strategic focus is not "help an agent answer one question," but "become the standard execution layer for agent-driven bio-data workflows."

One-line version:

> Let agents complete biological data retrieval and aggregation tasks reliably, in batch, with recovery and structured outputs that feed directly into downstream workflows.

## Why This Is The Main Strategy

For single-question answers, strong models can often get to the right answer with direct web/API access. That means `biocli` is unlikely to build durable advantage on "being smarter" alone.

It does have durable leverage in areas that web search and generic agents struggle to match consistently:

- Batch execution
- Stable result schemas
- Error recovery
- Reproducible provenance
- Methods/export
- Cache/snapshot
- Downstream-agent consumability

The product goal should therefore shift from "single-answer quality" to "workflow execution quality."

## Target Users

- Research engineers using Claude, Cursor, Codex, or similar agents for multi-step bioinformatics tasks
- Bioinformatics users processing gene lists, variant lists, or dataset lists in bulk
- Teams that need outputs to flow directly into notebooks, scripts, or downstream agent pipelines

## Non-Goals

- Do not turn `biocli` into a general chat or question-answering system
- Do not optimize the CLI itself to generate final high-level scientific conclusions
- Do not invest heavily in natural-language routing inside `biocli`
- Do not prioritize GUI work

## Core Product Principles

- Optimize for stable completion across many tasks, not single-run peak quality
- Outputs should be machine-consumable first, human-friendly second
- Batch mode is a first-class capability, not an outer shell loop around single-item commands
- Failures must be structured, resumable, and partial-success friendly
- Every high-value workflow should have a batch entrypoint

## Core Goals

### Goal 1

Make `biocli` the default execution layer for agent handling of gene lists and variant lists.

### Goal 2

Make batch tasks production-grade:

- Concurrency
- Progress
- Retries
- Failure summaries
- Resume

### Goal 3

Make batch outputs directly usable by downstream agents, notebooks, and pipelines.

## Priorities

### P0: Batch Infrastructure

Goal: build a shared batch runtime instead of reimplementing batch behavior per command.

Scope:

- Shared batch runner
- `--input -`
- `--input-file`
- `--concurrency`
- `--resume`
- `--fail-fast`
- `--max-errors`
- `--jsonl`
- Unified progress reporting
- Unified failure output
- Manifest summary

Suggested outputs:

- `results.jsonl`
- `failures.jsonl`
- `summary.json`
- `summary.csv`
- `manifest.json`

First commands to adopt it:

- `aggregate gene-profile`
- `aggregate gene-dossier`
- `aggregate drug-target`
- `aggregate tumor-gene-dossier`

Notes:

- `aggregate compare-genes` should not get batch mode unless list-of-lists semantics are explicitly designed.

Acceptance criteria:

- 100 gene symbols can be processed in one run
- Failed items do not block successful items from being written
- Interrupted runs can resume
- Agents can directly consume `results.jsonl`
- Progress shows `completed / failed / pending`

### P1: Pipeline-Friendly Outputs

Goal: turn batch results into something downstream can use immediately.

Scope:

- `--outdir`
- Automatic `summary.csv`
- Automatic `top_hits.csv` where command semantics justify it
- Stable per-command flattened columns
- `manifest.json` capturing:
- command
- input source
- runtime
- biocliVersion
- provenance summary
- warning counts
- failure counts
- Batch `methods.txt` / `methods.md`

Acceptance criteria:

- Users do not need extra scripts for common downstream handoff
- Batch outputs for the same command keep stable columns
- Each run can export a methods-ready text artifact

### P2: Recovery And Runtime Control

Goal: move from "can run in batch" to "safe for long-running workflows."

Scope:

- Item-level checkpoints
- Retry policy per backend
- Rate-limit awareness
- Backoff
- Per-command timeout override
- Per-item warning/error code
- Resume from manifest
- `skip cached / force refresh`

Acceptance criteria:

- Interrupted long runs are cheap to resume
- Network instability does not invalidate the whole run
- Users can distinguish transient failures from hard failures

### P3: Benchmark And Product Proof

Goal: measure agent enhancement as execution quality, not just answer quality.

Metrics:

- Completion rate
- Recovery rate
- Throughput
- Downstream parse success rate
- Time-to-structured-result
- Cost per 100 items

Benchmark scenarios:

- `100 genes -> gene-profile`
- `100 genes -> drug-target`
- `20 tumor genes -> tumor-gene-dossier`
- Resume after interruption
- Partial failure under flaky network

## Functional Design

### 1. Unified Input Interface

All batch-aware commands should support:

- `--input -`
- `--input-file <path>`
- `--input-format text|tsv|csv|jsonl`
- `--key <field>`

Examples:

```bash
cat genes.txt | biocli aggregate gene-profile --input - --concurrency 8 --jsonl
biocli aggregate drug-target --input-file genes.txt --disease lung --outdir runs/drug_scan
```

### 2. Unified Runtime Controls

Shared runtime flags:

- `--concurrency <n>`
- `--resume`
- `--fail-fast`
- `--max-errors <n>`
- `--timeout <sec>`
- `--retries <n>`

Requirements:

- All batch-aware commands use one shared runner
- Each command must not invent a custom batch system

### 3. Unified Output Contract

Suggested run directory layout:

```text
run/
  manifest.json
  summary.json
  summary.csv
  results.jsonl
  failures.jsonl
  methods.md
```

Semantics:

- `results.jsonl`: one successful structured result per item
- `failures.jsonl`: one structured failure per item, including input and retryability
- `summary.json`: totals, success count, failure count, warning count, runtime
- `summary.csv`: flattened high-value fields for filtering and sorting
- `manifest.json`: full run metadata

### 4. Unified Failure Model

Each failure record should include at least:

- `input`
- `command`
- `errorCode`
- `message`
- `retryable`
- `source`
- `attempts`
- `timestamp`

Without structured failures, agent pipelines cannot recover reliably.

### 5. Progress And Observability

Batch execution should expose:

- Total items
- Completed items
- Failed items
- Current throughput
- Estimated remaining time
- Current in-flight item count

Long-running tasks must be visibly alive and interpretable.

## First Hero Workflow Refactors

### gene-profile batch

Positioning: batch gene annotation entrypoint

Output emphasis:

- Core annotations
- Pathways
- Interactions
- Provenance

### drug-target batch

Positioning: batch target scan entrypoint

Output emphasis:

- Candidate drugs
- Ranking
- Sensitivity
- Disease-filter summary

### tumor-gene-dossier batch

Positioning: cohort-level tumor candidate scan

Output emphasis:

- Frequency
- Co-mutations
- Exemplar variants
- Tumor study summary

## Recommended CLI Shape

Two viable shapes:

```bash
biocli batch run aggregate gene-profile --input-file genes.txt
```

or:

```bash
biocli aggregate gene-profile --input-file genes.txt --outdir run1
```

Recommendation:

- Keep the external CLI light
- Prefer the second form for end users
- Internally still build one shared batch engine

## Success Metrics

### Product Metrics

- Batch command invocation count
- Average items per batch run
- Batch export rate
- Methods/export usage rate
- Resume usage rate

### Technical Metrics

- Completion rate
- Median throughput
- Recovery success rate
- Downstream parse success rate
- Per-item failure classification coverage

## Main Risks

- Each command builds its own batch implementation and the UX fragments
- Outputs remain raw JSON without useful roll-up artifacts
- Errors remain free text instead of structured failures
- Progress and resume remain too weak for long runs
- Team resources keep drifting back to single-question answer optimization

## Recommended Execution Order

1. Build the shared batch runner
2. Attach `aggregate gene-profile`
3. Attach `aggregate drug-target`
4. Add shared output directory artifacts: `results.jsonl`, `failures.jsonl`, `manifest.json`
5. Add `resume + progress`
6. Add benchmark coverage
