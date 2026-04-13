# biocli Benchmark

Reproducible evaluation of biocli against comparable bioinformatics CLI tools.

This directory now has two benchmark families:

- `benchmarks/`: tool-vs-tool command benchmark
- `benchmarks/agent-ab/`: agent-with-biocli vs agent-without-biocli outcome benchmark
- `benchmarks/pipeline/`: batch/pipeline execution harness for hero workflows
  Includes cold/warm cache runs, an interruption/resume scenario, and report materialization.

## Methodology

- **12 tasks** across 4 categories: Gene, Variant, Literature, Data Preparation
- **7 scoring dimensions**: Task Success (35%), Agent Readiness (20%), Workflow Depth (15%), Operational Safety (10%), Reproducibility (10%), Output Usability (5%), Efficiency (5%)
- **3 tools compared**: biocli, gget, BioMCP

Full scoring rubric: [rubric.md](rubric.md)
Task definitions: [tasks.yaml](tasks.yaml)

## How to Run

```bash
# 1. Run tasks for each tool
bash benchmarks/runners/run_biocli.sh
bash benchmarks/runners/run_gget.sh    # requires: pip install gget==0.30.3
bash benchmarks/runners/run_biomcp.sh  # requires: uv tool install biomcp-cli==0.8.19

# 2. Score results
npx tsx benchmarks/scripts/score.ts

# 3. View summary
cat benchmarks/results/$(date +%Y-%m-%d)/scored/summary.json
```

## Reproducibility

- All raw stdout/stderr saved in `results/<date>/raw/<tool>/`
- All scored results in `results/<date>/scored/`
- Runner scripts are deterministic (same inputs, same task order)
- Cross-cutting scores (Agent Readiness, etc.) are rubric-based — see [rubric.md](rubric.md) for criteria

## Directory Structure

```
benchmarks/
├── README.md          # This file
├── tasks.yaml         # 12 task definitions
├── rubric.md          # Scoring criteria and weights
├── runners/
│   ├── run_biocli.sh  # biocli task runner
│   ├── run_gget.sh    # gget task runner
│   └── run_biomcp.sh  # BioMCP task runner
├── scripts/
│   └── score.ts       # Automated scorer
└── results/
    └── YYYY-MM-DD/
        ├── raw/       # Raw task outputs
        └── scored/    # Scored results + summary
```
