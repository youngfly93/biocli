# Benchmark V2 Public Report: Quality on Executed Stable Cells

## Scope

This report reflects the current public-facing benchmark v2 state as executed on April 8, 2026. Coverage and quality remain separated by design, and core and workflow are not merged into a single total score.

Quality values below reflect executed and scored stable-batch cells only. They are not a claim that every supported task was executed in this public batch. Coverage percentages remain the broader capability view from the frozen matrix and may therefore exceed the number of scored tasks.

## Headline Findings

- No combined total score is reported. Core and workflow remain separate by design.
- In the current core x3 batch, biocli scored `96.747` quality at `73.000%` coverage.
- In the current workflow x3 batch, biocli scored `100.000` quality at `88.000%` coverage.
- Runtime executable versions are captured from each run bundle and summarized below.

## Core Track

- Batch label: `public-core-x3-stable`
- Repetitions: `3` cold runs per scheduled cell
- Scheduled cells: `26`
- Skipped cells: `26`
- Runner outcomes: completed `75`, execution_failed `3`, preflight_failed `0`
- Skipped-cell reasons: `heavy_excluded_by_default` x1, `non_native_capability_state` x21, `retry_sensitive_excluded_by_default` x2, `runner_missing` x2

| Tool | Coverage % | Quality | Supported tasks | Scored tasks | Latency p50 (ms) |
| --- | ---: | ---: | ---: | ---: | ---: |
| biocli | 73.000 | 96.747 | 9 | 9 | 128.130 |
| BioMCP | 68.000 | 84.473 | 9 | 9 | 2516.050 |
| gget | 39.000 | 91.400 | 5 | 3 | 9563.160 |
| EDirect | 65.000 | 97.398 | 8 | 5 | 5291.190 |

### Non-Completed Cells

- `biomcp` / `core-enrichment`: `execution_failed` x3

### Task-Level Medians

- biocli: `core-dataset-preview`=100.000, `core-dataset-search`=100.000, `core-enrichment`=87.500, `core-gene-basic`=100.000, `core-gene-sequence`=100.000, `core-literature-fetch`=100.000, `core-literature-search`=100.000, `core-variant-basic`=83.333, `core-variant-clinical`=100.000
- BioMCP: `core-disease-gene`=100.000, `core-drug-trial`=87.500, `core-enrichment`=28.333, `core-gene-basic`=80.000, `core-literature-fetch`=100.000, `core-literature-search`=100.000, `core-structure-fetch`=100.000, `core-variant-basic`=83.333, `core-variant-clinical`=83.333
- gget: `core-enrichment`=75.000, `core-gene-basic`=100.000, `core-gene-sequence`=95.000
- EDirect: `core-gene-basic`=100.000, `core-gene-sequence`=86.667, `core-literature-fetch`=100.000, `core-variant-basic`=100.000, `core-variant-clinical`=100.000

## Workflow Track

- Batch label: `public-workflow-x3-stable`
- Repetitions: `3` cold runs per scheduled cell
- Scheduled cells: `10`
- Skipped cells: `22`
- Runner outcomes: completed `30`, execution_failed `0`, preflight_failed `0`
- Skipped-cell reasons: `non_native_capability_state` x20, `runner_missing` x2

| Tool | Coverage % | Quality | Supported tasks | Scored tasks | Latency p50 (ms) |
| --- | ---: | ---: | ---: | ---: | ---: |
| biocli | 88.000 | 100.000 | 7 | 6 | 134.700 |
| BioMCP | 24.000 | 97.083 | 2 | 2 | 3837.810 |
| gget | 24.000 | 95.000 | 2 | 1 | 32523.090 |
| EDirect | 10.000 | 93.750 | 1 | 1 | 2323.390 |

### Non-Completed Cells

- none

### Task-Level Medians

- biocli: `workflow-batch-input`=100.000, `workflow-command-discovery`=100.000, `workflow-dry-run`=100.000, `workflow-schema-output`=100.000, `workflow-structured-help`=100.000, `workflow-working-dir`=100.000
- BioMCP: `workflow-batch-input`=100.000, `workflow-partial-failure`=95.000
- gget: `workflow-batch-input`=95.000
- EDirect: `workflow-batch-input`=93.750

## Runtime Versions

- biocli: `0.3.9` via `cli_help_banner`
- BioMCP: `0.8.19` via `cli_version_flag`
- gget: `0.30.3` via `python_dist_info`
- EDirect: `25.3` via `esearch_version_flag`

## Current Limitations

- `heavy` cells remain excluded from the default public batch.
- `retry_sensitive` cells remain excluded from the default public core batch until their variance is characterized separately.
- EDirect `core-dataset-search` remains coverage-only in the matrix. The public runner is intentionally withheld pending a stable `db=gds` UID handoff strategy.
- External service instability still matters. Failed cells should be read as benchmark evidence, not silently dropped.

## Artifacts

- [Frozen capability matrix](../../capability_matrix.frozen.csv)
- [Artifact index](../../artifact_index.md)
- [Core stable manifest](../public-core-x3-stable/manifest.json)
- [Core scorecard](../public-core-x3-stable/core_scorecard.json)
- [Workflow stable manifest](../public-workflow-x3-stable/manifest.json)
- [Workflow scorecard](../public-workflow-x3-stable/workflow_scorecard.json)
- [Machine-readable summary](public_summary.json)
- [core_overview.png](core_overview.png)
- [workflow_overview.png](workflow_overview.png)
- [task_breakdown.png](task_breakdown.png)
