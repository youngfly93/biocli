# Agent A/B Proof Block

Use this as the short public-facing benchmark narrative for release notes, blog posts, and package-facing docs when you want to explain what `biocli` adds to an agent.

It is intentionally small. The goal is to make one defensible claim from the current benchmark state, not to turn public docs into a raw evaluation dump.

## Product claim

`biocli` does not mainly make an agent smarter. It makes an agent more operational:

- better at batch work
- better at producing downstream-ready artifacts
- better at tool-native recovery
- more consistent on execution-heavy bioinformatics tasks

## Current evidence window

Scored reference set: `2026-04-15`

- scored runs: `24`
- completed: `23`
- partial: `1`
- failed: `0`
- model: `gpt-5.4-mini`

Important caveat:

- the single `partial` run was caused by an upstream `cBioPortal 503`, not by a local `biocli` contract failure
- the current scorecard uses `agent-ab-v1` operational scores; independent factual-accuracy, source-verifiability, and safety review is not complete, so this block makes execution claims only

## What the benchmark actually shows

| Task family | What wins with `biocli` | What does not meaningfully change |
|---|---|---|
| Single-item lookup | more direct command path, more native structure | generic reasoning can still compete |
| Cohort recovery | shorter, more product-native repair path | the non-`biocli` arm can still recover manually |
| Batch workflows | strongest win: native artifacts, resumable execution, lower operator burden | this is not mainly an “intelligence” effect |

## Safe public takeaway

Across the current A/B benchmark, the clearest `biocli` advantage is not better generic answers. It is better execution:

- one-shot batch outputs instead of manual synthesis
- reusable artifacts such as `results.jsonl`, `summary.csv`, `manifest.json`, and `methods.md`
- cleaner repair paths on identifier-heavy and cohort-recovery tasks

## Best proof points

Lead with these, not with simple lookup tasks:

- `batch-drug-target-lung-panel`
- `batch-gene-profile-panel`
- `recovery-invalid-study-cbioportal`

## Do not overclaim

Do not claim:

- `biocli` makes the model smarter
- `biocli` wins every task class
- the benchmark is fully normalized end-to-end

Do claim:

- `biocli` improves structured execution and batch workflow capability
- `biocli` reduces operator burden on workflow-shaped tasks
- `biocli` is most valuable when the task needs repeatable artifacts, recovery, or multi-database aggregation

## Source artifacts

- [Interim benchmark summary](../../benchmarks/agent-ab/results/2026-04-15/scored/summary.md)
- [Scored runs](../../benchmarks/agent-ab/results/2026-04-15/scored/scorecard.csv)
