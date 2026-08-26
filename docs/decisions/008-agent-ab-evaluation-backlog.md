# 008: Agent A/B Evaluation Backlog v0.1

## Purpose

This backlog turns [007-agent-ab-evaluation-prd.md](../../docs/decisions/007-agent-ab-evaluation-prd.md) into an execution plan.

The goal is to answer one product question quickly:

`Does biocli materially improve agent task execution in realistic biological workflows?`

This is not a feature backlog.

It is a validation backlog.

## Delivery Strategy

Recommended sequence:

1. Freeze the first evaluation protocol
2. Run a lightweight pilot
3. Score and review the pilot
4. Decide whether to expand, revise, or stop

Do not overbuild harnesses before the first pilot run.

## Scope For The First Evaluation Sprint

Included:

- one model
- one environment
- two arms
- six tasks
- three repeats per task per arm
- structured result artifacts
- manual scoring with a lightweight template

Not included:

- multi-model comparison
- large-scale automation
- publication-grade statistics
- broad competitor benchmarking

## Milestones

### M1: Freeze The Pilot Protocol

Outcome:

- first-run task subset selected
- prompts fixed
- scoring template fixed
- output locations fixed

### M2: Execute The Pilot

Outcome:

- all planned runs completed
- raw artifacts stored
- scorecard filled

### M3: Review And Decide

Outcome:

- one short report answering whether `biocli` shows a real capability delta
- one follow-up decision:
- expand
- revise
- or stop

## Backlog

### AB-001 Freeze The First-Run Task Set

Priority: `P0`

Goal:

- select a small but representative pilot task set

Deliverables:

- a `6`-task first-run task file
- coverage across:
- one-off hero workflows
- multi-step reasoning
- batch/pipeline
- recovery

Suggested files:

- [benchmarks/agent-ab/tasks.yaml](../../benchmarks/agent-ab/tasks.yaml)
- New: `benchmarks/agent-ab/first-run.tasks.yaml`

Definition of done:

- the team can start the pilot without debating task scope again

### AB-002 Freeze Prompt Policy

Priority: `P0`

Depends on:

- `AB-001`

Goal:

- make the black-box constraint operational

Deliverables:

- prompts for `with-biocli`
- prompts for `without-biocli`
- explicit rule that the agent may not read source or internal docs

Suggested files:

- [benchmarks/agent-ab/prompts.md](../../benchmarks/agent-ab/prompts.md)

Definition of done:

- both arms differ only by allowed product access, not by hidden hints

### AB-003 Freeze Scoring Template

Priority: `P0`

Depends on:

- `AB-001`

Goal:

- make run review lightweight and repeatable

Deliverables:

- a scorecard template with one row per run
- fixed columns for:
- completion
- structure
- recovery
- parseability
- runtime

Suggested files:

- [benchmarks/agent-ab/rubric.md](../../benchmarks/agent-ab/rubric.md)
- New: `benchmarks/agent-ab/scorecard.template.csv`

Definition of done:

- a reviewer can score one run in under five minutes

### AB-004 Freeze Artifact Layout

Priority: `P0`

Goal:

- make sure all runs land in one predictable structure

Deliverables:

- canonical result directory layout
- naming rules for raw transcripts, final JSON, and scored outputs

Suggested files:

- [benchmarks/agent-ab/README.md](../../benchmarks/agent-ab/README.md)

Definition of done:

- any reviewer can find raw artifacts and score outputs without ad hoc searching

### AB-005 Execute The First Pilot

Priority: `P1`

Depends on:

- `AB-001`
- `AB-002`
- `AB-003`
- `AB-004`

Goal:

- run the first controlled A/B evaluation

Pilot target:

- `6` tasks
- `3` repeats
- `2` arms

Definition of done:

- all planned runs completed or explicitly marked failed
- raw outputs saved

### AB-006 Fill The Scorecard

Priority: `P1`

Depends on:

- `AB-005`

Goal:

- convert raw runs into comparable outcomes

Deliverables:

- filled scorecard
- per-task notes
- summary counts

Definition of done:

- every run has a status and dimension-level scoring

### AB-007 Write The Review Memo

Priority: `P1`

Depends on:

- `AB-006`

Goal:

- answer whether `biocli` is producing a meaningful agent capability delta

Deliverables:

- one short report with:
- headline metrics
- notable wins
- notable failures
- recommended next move

Suggested files:

- New: `benchmarks/agent-ab/results/<date>/report.md`

Definition of done:

- the team can decide whether to keep polishing agent guidance or shift attention elsewhere

### AB-008 Decide The Next Iteration

Priority: `P1`

Depends on:

- `AB-007`

Goal:

- convert pilot findings into a concrete product decision

Possible outcomes:

- continue batch/pipeline productization
- improve hero workflow routing/guidance
- improve `agentSummary`
- reconsider claimed differentiation

Definition of done:

- one explicit next-step decision is recorded

## Recommended First-Run Task Mix

Use exactly six tasks in the first pilot:

1. `drug-target-egfr`
2. `tumor-gene-dossier-tp53-luad`
3. `gene-dossier-tp53`
4. `recovery-invalid-study-cbioportal`
5. one batch `drug-target` list scan
6. one batch `gene-profile` list scan

Reason:

- two high-value hero workflows
- one simpler retrieval baseline
- one recovery test
- two batch/pipeline tests

This is enough to expose whether `biocli` actually matters where it claims to matter.

## Recommended Pilot Rules

- use the same model and environment for both arms
- do not show the source tree to either arm
- do not embed command hints into prompts
- do not change the task phrasing between arms
- do not adjust prompts after seeing one or two failures

The first pilot should reduce uncertainty, not optimize the benchmark around the product.
