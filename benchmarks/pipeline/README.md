# Batch Pipeline Benchmark

This harness measures the batch/pipeline value of `biocli` on three hero workflows:

- `aggregate gene-profile`
- `aggregate drug-target`
- `aggregate tumor-gene-dossier`

It is intentionally narrower than the public benchmark suites under `benchmarks/` and `benchmarks/v2/`.
The goal here is not tool-vs-tool scoring. The goal is to prove execution-layer properties:

- batch completion
- durable run artifacts
- cache reuse
- snapshot metadata capture

## Usage

```bash
# cold cache run from source
npx tsx benchmarks/pipeline/run.ts --cache-mode cold --cli src

# warm cache run from dist
npx tsx benchmarks/pipeline/run.ts --cache-mode warm --cli dist

# interruption + resume scenario
npx tsx benchmarks/pipeline/resume.ts --cli dist

# materialize a markdown/json report from the collected runs
npx tsx benchmarks/pipeline/report.ts
```

## Output

Results are written to:

```text
benchmarks/pipeline/results/YYYY-MM-DD/<cold|warm>/
```

Each task writes:

- `logs/stdout.txt`
- `logs/stderr.txt`
- the command's own `--outdir` run directory
- a shared `summary.json` at the cache-mode root
- a date-level `report.md` / `report.json` once the report script is run

The summary records:

- task status and exit code
- wall-clock duration
- manifest path
- batch summary excerpt
- cache metadata
- snapshot metadata when available

The resume scenario records:

- partial successes captured before interruption
- resume duration
- skipped completed items from checkpoint recovery

## Fixtures

Gene lists live under:

```text
benchmarks/pipeline/fixtures/
```

They are intentionally small enough for routine validation while still exercising real batch behavior.
