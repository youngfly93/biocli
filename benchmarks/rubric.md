# Benchmark Scoring Rubric

## Overview

Each tool is evaluated on 12 tasks across 4 categories. Scoring combines task-level success with cross-cutting quality dimensions.

## Scoring Dimensions

| Dimension | Weight | What it measures |
|-----------|--------|------------------|
| **Task Success** | 35% | Does the tool complete the task? (per-task criteria) |
| **Agent Readiness** | 20% | Can an AI agent discover, select, and validate commands programmatically? |
| **Workflow Depth** | 15% | Can the tool go beyond querying to data preparation? |
| **Operational Safety** | 10% | Does the tool support preview/dry-run before destructive actions? |
| **Reproducibility** | 10% | Does the tool support caching, manifests, and deterministic output? |
| **Output Usability** | 5% | Is the output structured, typed, and machine-consumable? |
| **Efficiency** | 5% | How many commands and manual steps are needed? |

## Task Success Scoring

Each task has N success criteria (see `tasks.yaml`). Each criterion scores 0 or 1.

- **1** = criterion fully met
- **0** = criterion not met or requires manual workaround

Task score = met criteria / total criteria × max_score

## Agent Readiness Scoring (10 points)

| Criterion | Points | Description |
|-----------|--------|-------------|
| `list --json` | 1 | Machine-readable command listing |
| `help <cmd> --json` | 1 | Structured per-command help |
| `schema` output | 1 | JSON Schema for result validation |
| Per-command data schema | 1 | Schema for command-specific payload |
| Example output available | 1 | Representative JSON for each command |
| `whenToUse` / `whenNotToUse` | 1 | Agent routing guidance |
| `capabilities` descriptors | 1 | What each command can do |
| `relatedCommands` | 1 | Navigation between commands |
| Error recovery suggestions | 1 | Next-step hints on failure |
| Batch input support | 1 | `--input` file or stdin |

## Workflow Depth Scoring (10 points)

| Criterion | Points | Description |
|-----------|--------|-------------|
| Cross-database aggregation | 2 | Single command queries multiple databases |
| Dataset discovery | 2 | Search for relevant datasets by topic |
| Data download (GEO/SRA) | 2 | Download actual data files |
| Annotation fetching | 1 | Gene/pathway annotations alongside data |
| Working directory generation | 2 | Structured output directory with manifest |
| Plan/preview mode | 1 | Preview actions before execution |

## Operational Safety Scoring (10 points)

| Criterion | Points | Description |
|-----------|--------|-------------|
| `--dry-run` support | 2 | Preview downloads without executing |
| `--plan` support | 2 | Preview workflow steps without executing |
| `--max-size` guard | 1 | Prevent accidental large downloads |
| Partial failure reporting | 2 | Explicit warnings, not silent drops |
| Structured error codes | 1 | Machine-parseable error types |
| Graceful degradation | 2 | Works when some backends are unreachable |

## Reproducibility Scoring (10 points)

| Criterion | Points | Description |
|-----------|--------|-------------|
| Local response cache | 2 | Avoid redundant API calls |
| Cache control (`--no-cache`) | 1 | Force fresh data when needed |
| `manifest.json` generation | 2 | Full provenance for prepared data |
| Deterministic JSON envelope | 2 | Stable output schema across runs |
| `verify` / `doctor` diagnostics | 2 | System health check |
| Timestamped results (`queriedAt`) | 1 | Temporal reproducibility |

## How to Run

```bash
# Run all benchmarks for biocli
bash benchmarks/runners/run_biocli.sh

# Score results
npx tsx benchmarks/scripts/score.ts benchmarks/results/YYYY-MM-DD/raw/

# Generate summary
npx tsx benchmarks/scripts/summarize.ts benchmarks/results/YYYY-MM-DD/scored/
```

## Rules

1. All tools tested at their latest stable version at benchmark date
2. All tasks use the same inputs (defined in `tasks.yaml`)
3. Network environment: residential broadband, no VPN, NCBI API key configured
4. Raw stdout/stderr saved for every task
5. Automated scoring where possible; human rubric for subjective criteria
6. Results include exact versions, commit hashes, and run timestamps
7. No cherry-picking: all 12 tasks run, all results published
