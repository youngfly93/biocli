# Benchmark v2 Rubric

## Headline Rule

Do not publish a single overall winner score by default.

The default external presentation is:

1. `Coverage`
2. `Core Quality on Supported Tasks`
3. `Workflow Quality on Supported Tasks`
4. `Latency Profile`

If a blended scenario score is later added, it must be presented as scenario-specific, not universal.

## Track Interpretation

The workflow track measures capabilities that are explicit design goals of `biocli`: automation, previewability, reproducibility, and agent fit.

Tools that are intentionally optimized for narrower retrieval use cases are expected to score lower on the workflow track. That should be interpreted as a scope difference, not as a universal quality judgment.

## Coverage Scoring

Coverage is about surface area, not execution quality.

### Supported States

Count as supported:

- `native_single`
- `native_multi`

Do not count as supported:

- `adapter_pipeline`
- `unsupported`
- `unknown`

### Formula

For each tool:

`coverage_score = supported_task_weight / total_task_weight * 100`

Report coverage separately for:

- `core`
- `workflow`
- `overall`

## Quality Scoring

Quality is only computed on supported tasks.

Unsupported tasks must not be scored as zero-quality tasks. They belong in the coverage table.

### Core Task Score

Each supported core task is scored on a 0 to 100 scale:

- `Correctness`: 40
- `Completeness`: 25
- `Structure and Normalizability`: 20
- `Error Clarity`: 10
- `Execution Friction`: 5

### Workflow Task Score

Each supported workflow task is scored on a 0 to 100 scale:

- `Automation Fit`: 25
- `Safety and Preview Quality`: 25
- `Reproducibility`: 20
- `Observability and Error Clarity`: 20
- `Execution Friction`: 10

## Weight Rationale

Task weights are set by estimated real-world user value, not by which tool currently performs best.

- `workflow-working-dir` (20): Highest-weighted because it subsumes several downstream jobs at once: discovery, download, annotation, and provenance capture. In agent-driven workflows this is often the single most time-consuming step to execute manually.
- `workflow-partial-failure` (14): Next-highest because silent failure is a correctness hazard in multi-backend pipelines. A tool that returns incomplete data without telling the user can be worse than a tool that fails loudly.
- `workflow-command-discovery`, `workflow-schema-output`, `workflow-dry-run`, and `workflow-plan-mode` are all weighted in the low-teens because they materially change whether an agent can operate the tool safely without bespoke wrappers.
- Core tasks are weighted to keep common retrieval workflows important while still reserving meaningful space for cross-scope tasks such as sequence similarity, structure fetch, drug or trial lookup, and disease-gene association. Those tasks are included to expose product boundaries rather than to imply that every tool should optimize for every module.

### Dimension Definitions

#### Correctness

The returned result is factually aligned with the requested entity or task.

#### Completeness

The result contains the important fields expected for the task, not just a minimal stub.

#### Structure and Normalizability

The result can be transformed into a common JSON shape without brittle text scraping.

#### Error Clarity

Failures, missing data, and partial results are explicit and interpretable.

#### Execution Friction

Measures how much manual intervention is required.

Suggested guide:

- `100`: one native command, no manual cleanup
- `80`: two native commands with trivial piping
- `60`: three native commands or light manual mapping
- `0`: requires bespoke scripting, manual browsing, or hand edits

#### Automation Fit

Measures whether an agent or pipeline can reliably discover and operate the capability.

#### Safety and Preview Quality

Measures preview support before downloads or file writes.

#### Reproducibility

Measures whether the output includes manifests, deterministic structure, or stable provenance.

#### Observability and Error Clarity

Measures whether side effects, warnings, and failures are inspectable.

## Aggregate Quality Formulas

### Core Quality

`core_quality = weighted_average(task_score for supported core tasks only)`

### Workflow Quality

`workflow_quality = weighted_average(task_score for supported workflow tasks only)`

If a tool supports only one workflow task, publish that fact prominently next to the score.

## Normalization and Adjudication

Cross-tool quality scoring must operate on normalized outputs plus linked raw artifacts.

Minimum normalized record fields:

- `task_id`
- `tool`
- `tool_version`
- `capability_state`
- `commands_run`
- `latency_ms`
- `primary_records`
- `warnings`
- `errors`
- `raw_stdout_path`
- `raw_stderr_path`

Rules:

1. Raw stdout and stderr remain the source of truth.
2. Normalization may reshape fields, but it must not invent facts or merge records using custom domain logic.
3. Relevance judgments for search tasks must be documented with explicit adjudication notes.
4. Partial results must remain visible after normalization; they must not be flattened into apparently complete records.
5. Any scorer decision that depends on interpretation rather than exact field presence must be logged in an adjudication file.

## Latency Reporting

Latency is descriptive, not a main quality dimension.

For each supported task, run at least 3 times and report:

- `p50 latency`
- `p90 latency`

Rules:

- Prefer cold-cache runs for core retrieval comparisons.
- If a tool has a cache feature, benchmark cache behavior in a separate appendix.
- Do not let cache hits inflate the default cross-tool latency chart unless all tools are being compared in a warm-cache mode.

## Runner Rules

1. Each tool gets one benchmark runner.
2. A runner may use up to 3 native commands for a `native_multi` path.
3. Shell glue is allowed only for piping, file passing, and JSON concatenation.
4. A runner must not use custom Python, Node, or jq logic to synthesize missing product features.
5. Any non-trivial adapter code downgrades the task to `adapter_pipeline`.
6. If a task requires external adjudication notes, those notes must be checked into the benchmark results alongside the normalized outputs.

## Review Rules

Before public release, each non-biocli runner should satisfy one of:

- reviewed by the tool maintainer
- reviewed by an external power user with attribution
- reviewed against official examples with linked evidence

Publish reviewer status in the report.

## Publishing Rules

Every public result must link to:

- benchmark task spec
- scoring rubric
- runner scripts
- raw stdout and stderr
- normalized outputs
- adjudication notes when interpretation was required
- scoring logs
- exact tool versions

## Recommended Public Summary Template

Use wording like:

- `biocli has the broadest workflow coverage in this benchmark.`
- `BioMCP performs well on supported retrieval tasks but does not target workflow-prep tasks.`
- `gget remains strong in sequence-centric workflows but has narrower support in this benchmark's variant and workflow modules.`
- `EDirect remains a strong reference point for core NCBI retrieval tasks, even though it does not target the workflow track.`

Avoid wording like:

- `Tool A is objectively best overall.`
- `Tool B scored poorly` when the real story is limited benchmark scope.
