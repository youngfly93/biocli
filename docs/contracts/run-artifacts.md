# Batch Run Artifact Contract v0.1

## Purpose

This document defines the stable run directory contract for batch-capable workflows.

It exists so that:

- users know what files a batch run will produce
- downstream agents can consume the run directory without guessing
- future workflow changes do not silently break pipeline integrations

## Scope

This contract applies to hero workflows that support batch execution through:

- `--input-file`
- `--outdir`
- `--resume`

Current primary adopters:

- `aggregate gene-profile`
- `aggregate drug-target`
- `aggregate tumor-gene-dossier`

## Default Run Directory Shape

A successful batch run should produce a directory shaped like:

```text
run/
  results.jsonl
  failures.jsonl
  summary.json
  summary.csv
  manifest.json
  methods.md
```

`summary.csv` is optional when a command does not yet expose a stable flattener.

## Artifact Semantics

### `results.jsonl`

Purpose:

- one line per successful item

Shape:

- `input`
- `index`
- `attempts`
- `succeededAt`
- optional `cache`
- `result`

Use it when:

- a downstream agent needs full per-item results
- a notebook or script wants to stream records without loading one large array

### `failures.jsonl`

Purpose:

- one line per failed item

Shape:

- `input`
- `index`
- `command`
- `errorCode`
- `message`
- `retryable`
- optional `source`
- `attempts`
- `timestamp`
- optional `hint`
- optional `exitCode`

Use it when:

- you need to inspect partial failures
- you want to decide whether to retry failed items only

### `summary.json`

Purpose:

- compact machine-readable run summary

Shape:

- `command`
- `totalItems`
- `succeeded`
- `failed`
- `startedAt`
- `finishedAt`
- `durationSeconds`

Use it when:

- a scheduler or agent needs a quick health check for the whole run

### `summary.csv`

Purpose:

- flat table for spreadsheet, notebook, or quick filtering workflows

Rules:

- should only include stable columns
- should prefer high-signal fields over nested detail

Use it when:

- a user wants to sort, filter, or rank top results quickly
- an analyst wants a table before drilling into full JSON

Command-specific notes:

- `aggregate gene-profile`
  - current high-signal columns include `pathwayCount`, `interactionCount`, and `diseaseCount`
- `aggregate drug-target`
  - current high-signal columns include `matchedDisease`, `topSummaryDrugName`, `topSummaryDrugStage`, `topSummaryDrugScore`, `topSensitivityDrugName`, and `topSensitivityZScore`
- `aggregate tumor-gene-dossier`
  - current high-signal columns include `mutationFrequencyPct`, `topCoMutationGene`, `topCoMutationContextTag`, and `topVariantProteinChange`

### `manifest.json`

Purpose:

- canonical run metadata record

Required fields:

- `biocliVersion`
- `command`
- `outdir`
- `files`
- run timing and item counts

Common optional fields:

- `inputSource`
- `inputFormat`
- `key`
- `concurrency`
- `retries`
- `failFast`
- `maxErrors`
- `resume`
- `cache`
- `snapshots`

Use it when:

- you need reproducibility metadata
- you want to resume from a prior run
- you want to inspect cache policy or snapshot usage

### `methods.md`

Purpose:

- human-readable methods block for reports, notes, and manuscript drafting

Use it when:

- you need a first-pass methods description without manually reconstructing the run

## Resume Contract

When a workflow is rerun with:

- `--resume`
- or `--resume-from <manifest.json|run-dir>`

the new manifest should include a structured `resume` section with:

- `resumed`
- `source`
- `skippedCompleted`
- `previousSucceeded`
- `previousFailed`

## Cache And Snapshot Metadata

When cache-aware batch execution is enabled, `manifest.json` should include:

- `cache.policy`
- `cache.hits`
- `cache.misses`
- `cache.writes`

When a workflow consumes a local snapshot or prewarmed dataset, `manifest.json` may include:

- `snapshots[].dataset`
- `snapshots[].source`
- `snapshots[].path`
- `snapshots[].release`
- `snapshots[].fetchedAt`
- `snapshots[].refreshed`

This is especially important for:

- `aggregate drug-target` with local GDSC evidence

## Stability Rules

- File names in the run directory are part of the contract.
- New files may be added, but existing file names should not be renamed casually.
- `manifest.json` is the source of truth for artifact discovery.
- Agents should prefer `manifest.json` and `results.jsonl` over scraping CLI text output.

## Recommended Consumption Order

For agents:

1. Read `manifest.json`
2. Read `summary.json`
3. Read `results.jsonl`
4. Only inspect `failures.jsonl` if `failed > 0`

For humans:

1. Read `summary.csv`
2. Read `methods.md`
3. Drill into `results.jsonl` for full detail
