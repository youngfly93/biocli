# 006: Hero Workflow / Batch / Narrative Engineering Backlog v0.1

## Purpose

This backlog turns [005-hero-batch-narrative-prd.md](/Volumes/KINGSTON/work/research/biocli/ncbicli/docs/decisions/005-hero-batch-narrative-prd.md) into an execution plan.

Unlike [004-batch-pipeline-engineering-backlog.md](/Volumes/KINGSTON/work/research/biocli/ncbicli/docs/decisions/004-batch-pipeline-engineering-backlog.md), this backlog does not build batch infrastructure from scratch. That work already exists.

This phase focuses on the next strategic delta:

- make hero workflows easier for agents to consume
- make batch-first usage more obvious and more standardized
- tighten the external story so users understand the product in task terms

## Current Baseline

Already in place:

- shared batch runtime
- shared artifact contract
- resume/checkpoint support
- hero workflow batch support for `gene-profile`, `drug-target`, and `tumor-gene-dossier`
- benchmark proof for cold/warm cache and resume value

What is still missing:

- a stable `agentSummary` contract for hero workflows
- stronger batch-first help/docs/examples
- a task-first narrative across README, npm-facing docs, and release surfaces

## Delivery Strategy

Recommended sequence:

1. Define and ship summary contracts first
2. Use those contracts to rewrite examples and batch-facing docs
3. Rewrite external narrative last, once the product surface matches the story

Recommended reference workflows:

- `aggregate drug-target`
- `aggregate tumor-gene-dossier`

Reason:

- they are already the strongest product-level workflows
- they are the most likely entrypoints for downstream agent orchestration
- they currently expose the largest gap between rich data and easy consumption

## Milestones

### M1: Hero Summary Contracts

Outcome:

- `drug-target` and `tumor-gene-dossier` expose stable `agentSummary` layers
- `agentSummary` vs full-report semantics are documented
- agent consumers can use summary-first parsing

### M2: Batch-First Product Surface

Outcome:

- hero workflow docs, examples, and help output lead with `--input-file`, `--outdir`, `--resume`
- run artifacts are described as product outputs, not side effects

### M3: Narrative Compression

Outcome:

- README, release surfaces, and package-facing language emphasize three task entrypoints
- command-count framing is demoted

## Backlog

### HBN-001 `agentSummary` Contract Specification

Priority: `P0`

Goal:

- define one explicit machine-facing `agentSummary` contract for hero workflows

Deliverables:

- `agentSummary` contract for `aggregate drug-target`
- `agentSummary` contract for `aggregate tumor-gene-dossier`
- written semantics for:
- `agentSummary`
- `full`
- `warnings`
- `completeness`
- `recommendedNextStep`
- field naming conventions across hero workflows

Suggested file touch points:

- [005-hero-batch-narrative-prd.md](/Volumes/KINGSTON/work/research/biocli/ncbicli/docs/decisions/005-hero-batch-narrative-prd.md)
- New: `docs/contracts/hero-summary.md`
- [schema.ts](/Volumes/KINGSTON/work/research/biocli/ncbicli/src/schema.ts)
- [types.ts](/Volumes/KINGSTON/work/research/biocli/ncbicli/src/types.ts)

Definition of done:

- one agent consumer can extract top workflow findings without reading source
- `agentSummary` vs full-report semantics are documented once, not ad hoc in README prose

### HBN-002 Implement `drug-target.agentSummary`

Priority: `P0`

Depends on:

- `HBN-001`

Goal:

- add a stable, flatter `agentSummary` layer to `aggregate drug-target`

Suggested `agentSummary` fields:

- `topFinding`
- `topCandidates`
- `matchedDisease`
- `tumorContext`
- `topSensitivitySignals`
- `warnings`
- `completeness`
- `recommendedNextStep`

Deliverables:

- `agentSummary` field computation
- preserved full report payload
- tests for summary field stability
- schema/type updates

Suggested file touch points:

- [drug-target.ts](/Volumes/KINGSTON/work/research/biocli/ncbicli/src/clis/aggregate/drug-target.ts)
- [types.ts](/Volumes/KINGSTON/work/research/biocli/ncbicli/src/types.ts)
- [schema.ts](/Volumes/KINGSTON/work/research/biocli/ncbicli/src/schema.ts)
- [drug-target.test.ts](/Volumes/KINGSTON/work/research/biocli/ncbicli/src/clis/aggregate/drug-target.test.ts)

Definition of done:

- a consumer can extract top candidate name, stage, disease match, and strongest signal from one stable `agentSummary` object
- existing full data is not dropped

### HBN-003 Implement `tumor-gene-dossier.agentSummary`

Priority: `P0`

Depends on:

- `HBN-001`

Goal:

- add a stable, flatter `agentSummary` layer to `aggregate tumor-gene-dossier`

Suggested `agentSummary` fields:

- `topFinding`
- `prevalence`
- `topCoMutations`
- `exemplarVariants`
- `cohortContext`
- `warnings`
- `completeness`
- `recommendedNextStep`

Deliverables:

- `agentSummary` field computation
- preserved full report payload
- tests for prevalence/co-mutation summary shape
- schema/type updates

Suggested file touch points:

- [tumor-gene-dossier.ts](/Volumes/KINGSTON/work/research/biocli/ncbicli/src/clis/aggregate/tumor-gene-dossier.ts)
- [types.ts](/Volumes/KINGSTON/work/research/biocli/ncbicli/src/types.ts)
- [schema.ts](/Volumes/KINGSTON/work/research/biocli/ncbicli/src/schema.ts)
- [tumor-gene-dossier.test.ts](/Volumes/KINGSTON/work/research/biocli/ncbicli/src/clis/aggregate/tumor-gene-dossier.test.ts)

Definition of done:

- a consumer can identify cohort prevalence, strongest co-mutations, and representative variants from `agentSummary` alone
- `agentSummary` is stable enough to use in README and MCP examples

### HBN-004 Hero Summary Views In Docs And MCP

Priority: `P0`

Depends on:

- `HBN-002`
- `HBN-003`

Goal:

- align docs and MCP descriptions with `agentSummary`-first consumption

Deliverables:

- hero workflow examples that read `agentSummary` first
- updated MCP tool descriptions for hero workflows
- explicit note on full report availability

Suggested file touch points:

- [README.md](/Volumes/KINGSTON/work/research/biocli/ncbicli/README.md)
- [mcp-core.ts](/Volumes/KINGSTON/work/research/biocli/ncbicli/src/mcp-core.ts)
- [schema.ts](/Volumes/KINGSTON/work/research/biocli/ncbicli/src/schema.ts)

Definition of done:

- hero examples no longer force users to inspect deep nested objects before `agentSummary`
- MCP-facing descriptions match actual recommended consumption patterns

### HBN-005 Batch Help And CLI Copy Audit

Priority: `P1`

Goal:

- make batch-first usage visible in command help and CLI-facing copy

Deliverables:

- help text audit for:
- `gene-profile`
- `drug-target`
- `tumor-gene-dossier`
- batch examples that use:
- `--input-file`
- `--outdir`
- `--resume`
- explicit wording for run artifacts

Suggested file touch points:

- [commander-adapter.ts](/Volumes/KINGSTON/work/research/biocli/ncbicli/src/commander-adapter.ts)
- [gene-profile.ts](/Volumes/KINGSTON/work/research/biocli/ncbicli/src/clis/aggregate/gene-profile.ts)
- [drug-target.ts](/Volumes/KINGSTON/work/research/biocli/ncbicli/src/clis/aggregate/drug-target.ts)
- [tumor-gene-dossier.ts](/Volumes/KINGSTON/work/research/biocli/ncbicli/src/clis/aggregate/tumor-gene-dossier.ts)

Definition of done:

- running `--help` on hero workflows shows a batch-first example path
- users can discover `outdir/resume` without reading README first

### HBN-006 Run Artifact Contract Hardening

Priority: `P1`

Goal:

- make run artifacts feel like stable product outputs

Deliverables:

- explicit run directory docs
- artifact field inventory for:
- `results.jsonl`
- `failures.jsonl`
- `summary.json`
- `summary.csv`
- `manifest.json`
- `methods.md`
- command-specific notes where flattening differs

Suggested file touch points:

- New: `docs/contracts/run-artifacts.md`
- [README.md](/Volumes/KINGSTON/work/research/biocli/ncbicli/README.md)
- [batch-types.ts](/Volumes/KINGSTON/work/research/biocli/ncbicli/src/batch-types.ts)
- [batch-output.ts](/Volumes/KINGSTON/work/research/biocli/ncbicli/src/batch-output.ts)

Definition of done:

- another engineer or agent can read the docs and know exactly what each artifact is for
- artifact semantics no longer live only in code/tests

### HBN-007 Batch-First README Rewrite

Priority: `P1`

Depends on:

- `HBN-004`
- `HBN-005`
- `HBN-006`

Goal:

- rewrite the README opening around three task entrypoints and batch-first examples

Deliverables:

- new opening section
- task-first quick start
- batch-first hero workflow examples
- command-count framing demoted below the first screen

Suggested file touch points:

- [README.md](/Volumes/KINGSTON/work/research/biocli/ncbicli/README.md)

Definition of done:

- a new user can identify the three intended use cases within the first screen
- the first examples are workflow-level and batch-first

### HBN-008 Release Narrative Template

Priority: `P2`

Goal:

- make future release notes match the new product story

Deliverables:

- release-note template centered on:
- batch gene scanning
- tumor cohort profiling
- target triage
- benchmark proof block
- summary of agent-facing improvements

Suggested file touch points:

- [CHANGELOG.md](/Volumes/KINGSTON/work/research/biocli/ncbicli/CHANGELOG.md)
- [RELEASE_CHECKLIST.md](/Volumes/KINGSTON/work/research/biocli/ncbicli/RELEASE_CHECKLIST.md)
- New: `docs/release-template.md`

Definition of done:

- future releases can be written without falling back to command-count narratives

### HBN-009 npm / Package Surface Alignment

Priority: `P2`

Goal:

- align npm-facing text with the task-first story

Deliverables:

- package description review
- keyword review
- install verification copy aligned to hero workflows

Suggested file touch points:

- [package.json](/Volumes/KINGSTON/work/research/biocli/ncbicli/package.json)
- [README.md](/Volumes/KINGSTON/work/research/biocli/ncbicli/README.md)

Definition of done:

- npm-facing metadata reinforces the same story as README and release notes

### HBN-010 Benchmark Narrative Block

Priority: `P2`

Goal:

- distill benchmark proof into one small public-facing block

Deliverables:

- one concise benchmark table showing:
- cold vs warm
- cache-hit effect
- resume recovery
- hero workflow scope
- one reusable snippet for README/release notes

Suggested file touch points:

- [benchmarks/pipeline/results/2026-04-13/report.md](/Volumes/KINGSTON/work/research/biocli/ncbicli/benchmarks/pipeline/results/2026-04-13/report.md)
- [README.md](/Volumes/KINGSTON/work/research/biocli/ncbicli/README.md)

Definition of done:

- benchmark proof is short enough to support the narrative without overwhelming the reader

## Suggested PR Sequence

### PR-1 Summary Contract Foundation

Includes:

- `HBN-001`
- contract docs stub
- schema/type scaffolding

### PR-2 `drug-target.summary`

Includes:

- `HBN-002`
- tests
- minimal docs note

### PR-3 `tumor-gene-dossier.summary`

Includes:

- `HBN-003`
- tests
- minimal docs note

### PR-4 Hero Docs And MCP Alignment

Includes:

- `HBN-004`
- `HBN-005`

### PR-5 Batch-First Docs Pass

Includes:

- `HBN-006`
- `HBN-007`

### PR-6 Narrative Compression Pass

Includes:

- `HBN-008`
- `HBN-009`
- `HBN-010`

## Success Criteria

This backlog is successful when all three of the following are true:

1. Hero workflows can be consumed `agentSummary`-first by downstream agents.
2. Batch-first examples are the default way users encounter the product.
3. Public-facing docs describe `biocli` as a task execution layer, not a large command catalog.

## Open Questions

- Should `agentSummary` be returned by default or behind an explicit `--view summary|full` or `--view summary|full-report` switch?
- Should `summary.csv` for hero workflows mirror summary fields exactly, or remain a separate flattening optimized for spreadsheets?
- Should MCP expose summary-only hero tools, or continue exposing the full report and rely on descriptions?
