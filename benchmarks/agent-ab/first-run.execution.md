# First-Run Execution Plan

Use this file together with:

- [first-run.tasks.yaml](first-run.tasks.yaml)
- [first-run.prompts.md](first-run.prompts.md)
- [results/2026-04-15/run-matrix.csv](results/2026-04-15/run-matrix.csv)

This plan turns the first pilot into a fixed, repeatable execution order.

## Scope

- `6` tasks
- `2` arms
- `3` repeats per task
- `36` total runs

## Preconditions

Before starting the pilot:

1. Confirm both arms use the same model and environment.
2. Confirm `agent_with_biocli` can invoke installed `biocli`.
3. Confirm `agent_without_biocli` is explicitly blocked from invoking `biocli`.
4. Confirm outbound network is available in the actual execution environment.
5. Confirm raw outputs will be saved under:
   - `benchmarks/agent-ab/results/2026-04-15/raw/`

## Run Order

Run the pilot in three blocks to reduce order bias while keeping operator overhead low.

### Block A: Single-item retrieval / aggregation

1. `gene-dossier-tp53`
2. `drug-target-egfr`
3. `tumor-gene-dossier-tp53-luad`

### Block B: Recovery

4. `recovery-invalid-study-cbioportal`

### Block C: Batch / workflow

5. `batch-drug-target-lung-panel`
6. `batch-gene-profile-panel`

## Arm Rotation

Use alternating arm order by repeat:

- Repeat `001`: run `agent_with_biocli` first
- Repeat `002`: run `agent_without_biocli` first
- Repeat `003`: run `agent_with_biocli` first

This keeps the operator procedure simple while avoiding one arm always going first.

## Recommended Operator Sequence

For each row in [run-matrix.csv](results/2026-04-15/run-matrix.csv):

1. Copy the correct arm policy from [prompts.md](prompts.md).
2. Append the task prompt from [first-run.prompts.md](first-run.prompts.md).
3. Run the agent once.
4. Save:
   - final JSON artifact
   - transcript / notes
5. Record any visible failure or recovery action immediately.
6. Move to the next scheduled row.

For the `agent_with_biocli` arm:

- use `biocli` directly
- do not use `ncbicli` as a deprecated alias

## Naming Rules

Use the exact path pattern from the run matrix:

- JSON result:
  - `raw/<arm>/<task-id>/run-<repeat>.json`
- transcript / notes:
  - `raw/<arm>/<task-id>/run-<repeat>.md`

Examples:

- `raw/agent_with_biocli/drug-target-egfr/run-001.json`
- `raw/agent_without_biocli/batch-gene-profile-panel/run-003.md`

## Scoring Order

Do not score inline while collecting runs unless a run is obviously malformed.

Recommended flow:

1. Finish all raw runs
2. Fill [scorecard.csv](results/2026-04-15/scored/scorecard.csv)
3. Summarize findings in [summary.md](results/2026-04-15/scored/summary.md)

## Early Stop Conditions

Pause the pilot if any of the following happens:

- one arm is accidentally given the wrong policy
- the model or environment changes mid-run
- network is clearly unavailable for the entire session
- output artifacts stop following the required JSON contract

If paused, log the reason in the transcript for the affected run and restart from the last clean run boundary.
