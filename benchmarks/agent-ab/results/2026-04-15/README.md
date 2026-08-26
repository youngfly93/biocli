# Agent A/B Pilot Results: 2026-04-15

This directory is the result workspace for the first lightweight A/B pilot defined by:

- [007-agent-ab-evaluation-prd.md](../../../../docs/decisions/007-agent-ab-evaluation-prd.md)
- [008-agent-ab-evaluation-backlog.md](../../../../docs/decisions/008-agent-ab-evaluation-backlog.md)
- [first-run.tasks.yaml](../../first-run.tasks.yaml)
- [first-run.prompts.md](../../first-run.prompts.md)
- [first-run.execution.md](../../first-run.execution.md)

## Directory Layout

```text
results/2026-04-15/
  README.md
  raw/
    README.md
    run.template.json
    run.template.md
    agent_with_biocli/
    agent_without_biocli/
  scored/
  run-matrix.csv
    README.md
    scorecard.csv
    summary.md
```

## Run Naming

Recommended naming convention:

- raw JSON artifact:
  - `raw/<arm>/<task-id>/run-001.json`
- raw transcript or notes:
  - `raw/<arm>/<task-id>/run-001.md`

Examples:

- `raw/agent_with_biocli/drug-target-egfr/run-001.json`
- `raw/agent_without_biocli/recovery-invalid-study-cbioportal/run-002.md`

## Pilot Scope

Use exactly these six tasks for the first pilot:

1. `gene-dossier-tp53`
2. `drug-target-egfr`
3. `tumor-gene-dossier-tp53-luad`
4. `recovery-invalid-study-cbioportal`
5. `batch-drug-target-lung-panel`
6. `batch-gene-profile-panel`

Recommended run count:

- `3` repeats per task
- `2` arms
- total planned runs: `36`

Use [run-matrix.csv](run-matrix.csv) as the source of truth for run order and artifact paths.

## Review Flow

1. Save raw run artifacts under `raw/`
2. Score each run into `scored/scorecard.csv`
3. Write headline takeaways into `scored/summary.md`

Do not rewrite prompts or task definitions in the middle of the first pilot.
