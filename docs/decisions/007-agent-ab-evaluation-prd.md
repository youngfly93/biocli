# 007: Agent A/B Evaluation PRD v0.1

## Purpose

This document defines a black-box evaluation plan for one specific product question:

`Does biocli materially improve an agent's ability to complete biological data tasks?`

The goal is not to prove that `biocli` makes the model "smarter."

The goal is to measure whether `biocli` improves:

- task completion
- reliability
- recovery
- batch execution
- downstream consumability

This evaluation should run before another major round of product-surface polishing.

## Decision Context

`biocli` has moved quickly from `v0.4.x` to `v0.7.x` and already includes:

- hero workflows
- MCP support
- `agentSummary`
- batch/pipeline artifacts
- retry/recovery
- provenance/methods

The current product hypothesis is strong but still partially internal:

- agents will choose hero workflows
- agents will benefit from `agentSummary`
- batch/pipeline is the durable advantage over direct web/API usage

Those claims now need direct empirical validation.

## Primary Question

Does access to `biocli` increase an agent's effective task execution capability relative to a comparable agent without `biocli`?

## Secondary Questions

1. Does `biocli` improve first tool choice?
2. Does `biocli` improve recovery from upstream or parameter errors?
3. Does `biocli` improve downstream machine-readability of results?
4. Does `biocli` provide a larger advantage in batch/pipeline tasks than in one-off tasks?
5. Which hero workflows are actually chosen by the agent when no internal guidance is provided?

## Product Thesis Under Test

`biocli` should not primarily compete on one-shot answer quality.

It should compete on:

- reliability
- structure
- task packaging
- resumability
- batch throughput

The evaluation should therefore measure more than correctness.

## Evaluation Design

### Arms

#### Arm A: Agent + biocli

The agent may use:

- installed `biocli`
- local shell
- ordinary system tools
- web/API access available in the test environment

The agent may not read the `biocli` source tree or internal design docs during the test.

It should interact with `biocli` as an external installed product.

#### Arm B: Agent without biocli

The agent may use:

- local shell
- ordinary system tools
- web/API access available in the test environment

The agent may not call `biocli` directly.

It must solve tasks via web/API/manual scripting only.

### Black-Box Rule

Both arms should be tested in a black-box setup:

- do not provide source code
- do not provide product-internal hints
- do not say which command should be used
- do not say which workflow is preferred

Otherwise the experiment measures prompt steering instead of product usability.

### Model Consistency

Use the same base model for both arms.

If possible:

- same model
- same reasoning level
- same environment
- same task prompts

The only intended difference should be access to `biocli`.

### Number of Runs

Minimum:

- `5-8` tasks
- `3` runs per task per arm

Preferred:

- `8-12` tasks
- `3-5` runs per task per arm

This is enough to expose systematic differences without turning the evaluation into a research project.

## Task Set

The task set should include three categories.

### Category A: One-Off Hero Workflow Tasks

Purpose:

- test first tool choice
- test whether `biocli` helps on compact, real tasks

Examples:

1. Find targetable drugs for `EGFR` in `lung`.
2. Produce a tumor-specific briefing for `TP53` in `acc_tcga_pan_can_atlas_2018`.
3. Produce a gene profile for `BRCA1` suitable for downstream triage.

Expected outcome:

- differences may be modest
- quality may be similar
- structure and path efficiency may differ

### Category B: Multi-Step Reasoning Tasks

Purpose:

- test whether `biocli` helps agent planning and execution across multiple steps

Examples:

1. For a given gene, retrieve pathway context, tumor prevalence, and candidate drugs, then produce a concise shortlist.
2. Compare whether `PIK3CA` or `EGFR` is a stronger lung-focused target based on available evidence.
3. Build a tumor-contextual summary and recommend the next command or analysis step.

Expected outcome:

- `biocli` should improve structure and recovery
- web-only agents may still succeed but with more tool switching and more format adaptation

### Category C: Batch / Pipeline Tasks

Purpose:

- test the product's strongest stated advantage

Examples:

1. Run `drug-target` across a list of `20-50` genes and return a machine-readable shortlist.
2. Run `gene-profile` across a gene list and produce artifacts suitable for downstream filtering.
3. Interrupt a run and recover it using resume/checkpoint semantics.

Expected outcome:

- this is where `biocli` should show the largest practical advantage
- if the advantage is not visible here, the strategic thesis is weak

## Success Metrics

### Primary Metrics

#### 1. Task Completion Rate

Definition:

- fraction of runs that reach a materially usable final answer

Usable means:

- result is not obviously broken
- result addresses the requested task
- result contains enough information for a downstream user or agent to continue

#### 2. Time To First Usable Structured Result

Definition:

- time until the agent first produces a structured result that could be consumed downstream

This matters more than raw latency for agent pipelines.

#### 3. Time To Final Deliverable

Definition:

- total wall-clock time from task start to final response

#### 4. Downstream Parse Success Rate

Definition:

- fraction of outputs that a second agent or script can consume without custom repair

This should be measured against:

- `agentSummary`
- artifact files
- final JSON payloads

### Secondary Metrics

#### 5. First Tool Choice Accuracy

Definition:

- whether the agent's first significant tool choice matches the most appropriate product surface

Examples:

- hero workflow instead of multiple low-level calls
- batch path instead of repeated one-off calls for list tasks

#### 6. Error Recovery Rate

Definition:

- fraction of failing intermediate runs that recover to a usable final answer

Examples:

- wrong study ID
- over-narrow disease filter
- transient upstream failure

#### 7. Manual Intervention Needed

Definition:

- whether a human had to clarify, redirect, or repair the run

#### 8. Batch Throughput

Definition:

- useful items completed per minute in list-based tasks

#### 9. Artifact Completeness

Definition:

- whether the output includes reusable artifacts such as:
- structured JSON
- CSV summaries
- manifest
- methods/provenance

## Scoring Rubric

The canonical scoring source is [`benchmarks/agent-ab/rubric.md`](../../benchmarks/agent-ab/rubric.md), version `agent-ab-v1`.

Each run is scored on a simple `0-2` scale per operational dimension:

- `0`: failed or unusable
- `1`: partial / degraded / manually repairable
- `2`: successful and reusable

Recommended dimensions:

- task completion
- structure quality
- downstream parseability
- recovery behavior
- efficiency (including batch suitability and artifact/operator burden for batch tasks)

This keeps manual review lightweight and comparable.

Factual accuracy, source verifiability, and safety are independent evidence reviews, not additional numeric dimensions. They must be recorded using `benchmarks/agent-ab/evidence-review.template.csv`; until completed, the result set cannot support public accuracy, source-backed-rate, or safety claims.

## Recording Template

For each run, record:

- task ID
- arm (`with-biocli` / `without-biocli`)
- model
- run timestamp
- first major tool choice
- task completed (`yes/no/partial`)
- time to first structured result
- time to final answer
- recovery needed (`yes/no`)
- recovery succeeded (`yes/no`)
- output artifact type
- downstream parse success (`yes/no`)
- rubric version
- factual/source/safety review status or linked evidence-review row
- reviewer notes

## Task Prompt Design

Task prompts should be realistic and minimal.

Good prompts:

- "Find lung-focused drug candidates for EGFR and return a concise machine-readable summary."
- "Prepare a tumor-contextual summary for TP53 in acc_tcga_pan_can_atlas_2018."
- "Run a target triage for this 20-gene list and write outputs suitable for downstream filtering."

Bad prompts:

- prompts that mention `biocli`
- prompts that mention specific commands
- prompts that contain implementation hints

## Environment Requirements

Use the same environment for both arms wherever possible:

- same machine or container class
- same network access
- same shell/tool permissions
- same timeout policy

If the environment differs, note it explicitly in results.

This is especially important because network restrictions can otherwise dominate the outcome.

## Expected Result Patterns

The likely pattern is:

- one-off tasks: modest advantage
- multi-step tasks: moderate advantage
- batch/pipeline tasks: strong advantage

That result would support the current product strategy.

Possible alternative outcomes:

### Outcome A: Strong Advantage Only In Batch Tasks

Interpretation:

- the product thesis is directionally correct
- messaging should lean even harder into pipeline execution

### Outcome B: No Clear Advantage Anywhere

Interpretation:

- current differentiation is not visible enough
- either workflows are still too hard to choose
- or the product is not materially better than direct web/API access

### Outcome C: Strong Advantage In Reliability But Not Final Quality

Interpretation:

- this is still a product win
- `biocli` is functioning as a workflow execution layer, not an answer generator

## Non-Goals

This evaluation should not attempt to answer:

- whether `biocli` is scientifically better than all competing tools
- whether one specific model family is universally superior
- whether every command in the CLI surface is equally valuable

The evaluation is specifically about the effect of `biocli` on agent-mediated task execution.

## Output Artifacts

This evaluation should produce:

- a task matrix
- raw run logs
- scored run table
- summary comparison table
- one short narrative report

Recommended output files:

- `benchmarks/agent-ab/tasks.json`
- `benchmarks/agent-ab/results/*.json`
- `benchmarks/agent-ab/scorecard.csv`
- `benchmarks/agent-ab/report.md`

## Go / No-Go Criteria For Next Product Iteration

Use the results to choose the next move.

### If biocli wins mainly on batch and recovery

Next move:

- continue investing in batch/pipeline productization
- reduce effort on one-shot answer optimization

### If biocli wins mainly on hero workflow selection and structure

Next move:

- continue compressing the product around hero surfaces

### If biocli shows weak advantage even in batch tasks

Next move:

- revisit core differentiation before polishing agent guidance further

## Recommended Immediate Next Step

Run a first lightweight evaluation with:

- `6` tasks
- `3` runs per task per arm
- one model
- one environment

Do not wait for a perfect harness.

The first job is to reduce uncertainty, not to produce a publication-grade benchmark.
