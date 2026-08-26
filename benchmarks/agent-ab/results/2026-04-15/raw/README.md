# Raw Run Artifacts

This directory stores unscored agent outputs from the first pilot.

## What To Save

For each run, save:

- one final JSON artifact
- one markdown transcript or run notes file

Recommended per-run pair:

- `run-001.json`
- `run-001.md`

## Minimum JSON Contract

Base each JSON file on [run.template.json](run.template.json).

Required fields:

- `task_id`
- `arm`
- `status`
- `final_answer`
- `sources`
- `commands_used`
- `web_queries`
- `warnings`
- `errors`
- `recovery_actions`
- `runtime`

## Arm Directories

Store runs under:

- `agent_with_biocli/`
- `agent_without_biocli/`

Each task should have its own subdirectory inside the arm directory.

Example:

```text
raw/agent_with_biocli/drug-target-egfr/run-001.json
raw/agent_with_biocli/drug-target-egfr/run-001.md
```
