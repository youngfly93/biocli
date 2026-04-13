# Pipeline Benchmark Report (2026-04-13)

## Scope

This report summarizes the batch/pipeline benchmark for the three hero workflows:

- `aggregate gene-profile`
- `aggregate drug-target`
- `aggregate tumor-gene-dossier`

The benchmark compares a cold run against a warm `--skip-cached` run using the same task-level cache home.

## Headline Findings

- All three workflows completed successfully in both cold and warm modes.
- Warm runs hit cached batch results for every item in every workflow.
- The warm path reduced wall-clock runtime from tens of seconds to sub-second execution.

## Cold vs Warm

| Task | Cold | Warm | Speedup | Warm cache hits |
| --- | ---: | ---: | ---: | ---: |
| gene-profile-batch | 15353 ms | 204 ms | 75.3x | 10/10 |
| drug-target-batch | 26119 ms | 185 ms | 141.2x | 8/8 |
| tumor-gene-dossier-batch | 22217 ms | 106 ms | 209.6x | 6/6 |

## Snapshot Evidence

- drug-target-batch: GDSC (8.5)

## Resume Scenario

- Interrupted run signal: `SIGTERM`
- Partial successes captured before resume: `3`
- Resume status: `ok`
- Resume duration: `23087 ms`
- Final succeeded items: `10`
- Resume checkpoint skipped completed: `3`


## Artifacts

- [Cold summary](benchmarks/pipeline/results/2026-04-13/cold/summary.json)
- [Warm summary](benchmarks/pipeline/results/2026-04-13/warm/summary.json)
- [Resume summary](benchmarks/pipeline/results/2026-04-13/resume/gene-profile-interruption/summary.json)

