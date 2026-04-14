# 005: Hero Workflow / Batch / Narrative PRD v0.1

## Purpose

This PRD turns the current product direction into one integrated strategy:

1. Productize hero workflows
2. Make batch/pipeline the default usage model
3. Compress external narrative around a few high-value task entrypoints

The goal is not to add more commands. The goal is to make `biocli` legible, repeatable, and compelling as an agent execution layer for biological workflows.

## Product Thesis

`biocli` should not compete on "being smarter than the model."

It should compete on:

- Stable execution
- High-value workflow packaging
- Batch throughput
- Recovery and resumability
- Structured, agent-consumable outputs

That means the product center of gravity should move away from "65 commands" and toward a smaller set of task-level entrypoints:

- Batch gene scanning
- Tumor cohort profiling
- Target discovery / drug-target triage

## Problem Statement

The product has crossed the "works end-to-end" threshold, but three gaps remain:

1. Hero workflows are powerful but still too report-shaped and too nested for downstream agents.
2. Batch/pipeline support exists, but is not yet the default user mental model.
3. Public narrative still risks emphasizing breadth of commands instead of depth of task completion.

If these are not corrected, `biocli` will remain technically strong but strategically diffuse.

## Target Users

- Research engineers using Claude, Cursor, Codex, or similar agentic environments
- Bioinformatics users working from gene lists, cohort-specific candidate sets, or target triage queues
- Teams that need reproducible artifacts for downstream notebooks, scripts, or multi-agent pipelines

## Non-Goals

- Do not prioritize adding large numbers of new atomic commands
- Do not optimize for single-question, chat-style answers as the primary value
- Do not build a general natural-language routing layer inside `biocli`
- Do not lead product messaging with total command count or backend count

## Product Principles

- Task entrypoints should be clearer than backend coverage
- Machine-facing summaries should be first-class outputs
- Batch should feel like the default, not an advanced mode
- Narrative should reflect what the product is best at today, not everything it can technically do
- Each new layer should reduce downstream agent guesswork

## Strategic Goals

### Goal 1: Productize Hero Workflows

Make `drug-target` and `tumor-gene-dossier` the default entrypoints for target triage and tumor-specific gene assessment.

### Goal 2: Make Batch/Pipeline The Default Usage Model

Make file-driven, resumable, artifact-producing runs feel like the primary way to use hero workflows at scale.

### Goal 3: Tighten Product Narrative

Make new users understand the product in terms of three task outcomes, not a long command catalog.

## Strategy 1: Hero Workflow Productization

### Objective

Turn `drug-target` and `tumor-gene-dossier` from rich nested reports into predictable agent-ready workflow surfaces.

### Why It Matters

These workflows already contain the product's highest-value reasoning substrate:

- Cross-database aggregation
- Tumor-specific context
- Drug / evidence / sensitivity synthesis
- Structured provenance

The remaining issue is not missing data. It is output usability.

### Scope

#### 1. Add a stable machine-facing summary layer

To avoid colliding with existing command-local `summary` fields that already mean "counts" or "run stats", the new external contract should use:

- `agentSummary`
- `full`

`agentSummary` should be intentionally smaller and flatter than the current report body.

Suggested `drug-target.agentSummary` fields:

- `topFinding`
- `topCandidates`
- `matchedDisease`
- `tumorContext`
- `topSensitivitySignals`
- `warnings`
- `completeness`
- `recommendedNextStep`

Suggested `tumor-gene-dossier.agentSummary` fields:

- `topFinding`
- `prevalence`
- `topCoMutations`
- `exemplarVariants`
- `cohortContext`
- `warnings`
- `completeness`
- `recommendedNextStep`

#### 2. Preserve the full report contract

The existing nested report remains available under `full` or equivalent preserved fields so current power users do not lose detail.

#### 3. Normalize field names

Avoid loosely equivalent field variants across workflows.

Examples:

- prefer one canonical top-level candidate field
- prefer one canonical stage/phase naming convention
- use one consistent warnings/completeness shape

#### 4. Add explicit agent-facing schema docs

For each hero workflow, document:

- fields intended for downstream automation
- fields intended for human review
- fields that are heterogeneous or source-specific

### Deliverables

- Stable `agentSummary` contract for `aggregate drug-target`
- Stable `agentSummary` contract for `aggregate tumor-gene-dossier`
- Schema updates
- README examples using summary-first extraction patterns
- MCP hero tool descriptions aligned with summary-first usage

### Acceptance Criteria

- A downstream agent can extract the top recommendation without inspecting source code
- `agentSummary` output stays stable across releases unless explicitly versioned
- The number of agent-side field-specific fallbacks needed to consume hero outputs is materially reduced
- README can show these workflows as primary examples without extra explanation

### Metrics

- Hero workflow share of total usage
- Downstream parse success rate for `agentSummary`
- Number of schema-specific patches needed in internal agent prompts or wrappers

### Risks

- Over-flattening could remove nuance users still need
- Adding `agentSummary` without documenting full vs full-report semantics could create confusion

## Strategy 2: Batch/Pipeline As Default Mental Model

### Objective

Make users think in terms of runs, inputs, outputs, and recovery, not one-off command invocations.

### Why It Matters

This is the clearest durable advantage over direct web/API usage:

- Scale
- Repeatability
- Resume
- Structured artifacts
- Cache-aware execution

### Scope

#### 1. Promote the shared batch contract to first-class status

Across hero workflows, the canonical operating path should include:

- `--input-file`
- `--outdir`
- `--resume`
- `--skip-cached`
- `--force-refresh`
- `--jsonl`

#### 2. Standardize the run directory as product surface

Every batch hero run should reliably produce:

- `results.jsonl`
- `failures.jsonl`
- `summary.json`
- `summary.csv`
- `manifest.json`
- `methods.md`

#### 3. Improve run observability

Surface at least:

- completed count
- failed count
- cache hits
- snapshot usage
- resume source
- elapsed time

#### 4. Strengthen handoff artifacts

`summary.csv` and `methods.md` should be treated as product outputs, not internal convenience files.

#### 5. Reframe examples and docs around list inputs

Examples should start from:

- a gene list file
- a target triage list
- a cohort candidate set

not from a single identifier unless introducing the concept.

### Deliverables

- Batch-first examples for `gene-profile`, `drug-target`, and `tumor-gene-dossier`
- Stable run directory documentation
- Explicit resume and cache semantics in help/docs
- Stronger progress and artifact descriptions in README

### Acceptance Criteria

- A new user can run a hero workflow from an input file without reading implementation details
- Interrupted runs can be resumed from a manifest or run directory with no manual state surgery
- The produced run directory is directly usable by another agent or notebook
- The README's main example path is batch-first

### Metrics

- Share of hero workflow invocations using `--input-file` or stdin
- Average items per run
- Resume usage rate
- Cache-hit rate in repeat runs
- Artifact reuse rate in downstream tasks

### Risks

- Users may still treat batch as advanced if single-item examples dominate docs
- Run artifact contracts can drift if not explicitly versioned and tested

## Strategy 3: Narrative Compression Around Three Task Entry Points

### Objective

Make the product legible in 30 seconds.

### Why It Matters

Even when the engineering is strong, diffuse messaging makes the product feel broader but weaker.

The right narrative is not:

> A CLI with 65 commands across many databases

The right narrative is:

> An agent execution layer for batch gene scanning, tumor cohort profiling, and target discovery.

### Scope

#### 1. Reframe homepage and package description

Lead with task entrypoints:

- Batch gene scanning
- Tumor cohort profiling
- Drug-target triage

Do not lead with command count.

#### 2. Use hero workflows as the default demo path

README, npm description, release notes, and demos should all prioritize:

- `aggregate gene-profile --input-file`
- `aggregate tumor-gene-dossier --input-file ... --study ...`
- `aggregate drug-target --input-file ... --disease ...`

#### 3. Reframe MCP as an access path, not the main story

Do not say:

- "biocli has MCP"

Prefer:

- "Claude/Cursor can directly call the same hero workflows"

#### 4. Use benchmark proof surgically

One concise benchmark table is enough if it proves:

- cold vs warm execution
- cache-hit effect
- resume recovery
- stable artifact generation

#### 5. Align messaging across release surfaces

The same core wording should appear in:

- README
- npm package metadata
- release notes
- benchmark report intro
- MCP-related docs

### Deliverables

- Rewritten README opening section
- Updated npm package description/keywords if needed
- Release note template aligned to task-first narrative
- Benchmark summary block for public-facing docs

### Acceptance Criteria

- A new reader can identify the three intended use cases within the first screen of the README
- Primary examples are hero workflows, not atomic lookups
- Public product messaging no longer relies on command-count framing

### Metrics

- README scroll depth / click-through on hero workflow sections
- Share of docs examples that are workflow-level instead of atomic
- External issue or user question mix shifting toward workflow usage rather than command discovery

### Risks

- Over-compressing the narrative may hide real breadth from advanced users
- README changes alone will not fix product perception if CLI help remains command-centric

## Recommended Delivery Sequence

### Phase 1

- Add `summary` layers to `drug-target` and `tumor-gene-dossier`
- Document summary vs full semantics

### Phase 2

- Make batch-first examples the default documentation path
- Tighten run artifact messaging

### Phase 3

- Rewrite external narrative across README, npm, release notes, and benchmark intro

## Dependencies

- [003-batch-pipeline-prd.md](/Volumes/KINGSTON/work/research/biocli/ncbicli/docs/decisions/003-batch-pipeline-prd.md)
- [004-batch-pipeline-engineering-backlog.md](/Volumes/KINGSTON/work/research/biocli/ncbicli/docs/decisions/004-batch-pipeline-engineering-backlog.md)
- Current hero workflows:
- [drug-target.ts](/Volumes/KINGSTON/work/research/biocli/ncbicli/src/clis/aggregate/drug-target.ts)
- [tumor-gene-dossier.ts](/Volumes/KINGSTON/work/research/biocli/ncbicli/src/clis/aggregate/tumor-gene-dossier.ts)

## Open Questions

- Should summary shapes be versioned explicitly if full-report contracts continue to evolve?
- Should hero workflows gain an explicit `--view summary|full` flag, or should both be returned together?
- Should README and npm positioning shift immediately in the next patch, or align with the next minor release?

## Decision

For the next product phase, `biocli` should invest in depth over breadth:

- stronger hero workflows
- stronger batch defaults
- tighter task-first narrative

That is the shortest path from "technically impressive" to "strategically legible."
