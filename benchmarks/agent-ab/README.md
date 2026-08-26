# Agent A/B Benchmark

This benchmark measures whether `biocli` improves agent performance on real bioinformatics tasks.

It is the execution layer for [007-agent-ab-evaluation-prd.md](../../docs/decisions/007-agent-ab-evaluation-prd.md) and [008-agent-ab-evaluation-backlog.md](../../docs/decisions/008-agent-ab-evaluation-backlog.md).

It is intentionally different from `benchmarks/v2`:

- `v2` compares tool surfaces
- `agent-ab` compares agent outcomes under two tool-use policies

## Arms

- `agent_with_biocli`: the agent may use any available tools, but should prefer `biocli` for biological retrieval, aggregation, and workflow preparation when it is relevant
- `agent_without_biocli`: the agent must not invoke `biocli` or reuse `biocli` outputs; it may use web search, reasoning, and other non-`biocli` tools

The goal is not to prove that one arm always wins. The goal is to learn:

- which task families gain from `biocli`
- where `biocli` reduces hallucination or ambiguity
- where generic web/reasoning is already sufficient
- where agent guidance or catalog metadata still fails

## What To Measure

Score each run with the canonical [`agent-ab-v1` rubric](rubric.md):

1. Task completion (`0-2`)
2. Structural usability (`0-2`)
3. Downstream parseability (`0-2`)
4. Recovery behavior (`0-2`)
5. Efficiency (`0-2`)

Factual accuracy, source verifiability, and safety are reviewed separately with [evidence-review.template.csv](evidence-review.template.csv). Do not publish accuracy/source/safety rates while those reviews are `unreviewed` or the scored-set manifest says `not_completed`.

## Output Contract

Each agent run should emit one JSON object with this shape:

```json
{
  "task_id": "tumor-gene-dossier-tp53-luad",
  "arm": "agent_with_biocli",
  "status": "completed",
  "final_answer": {
    "summary": "short human-readable answer",
    "result": {}
  },
  "sources": [
    {
      "label": "cBioPortal",
      "url": "https://www.cbioportal.org/",
      "record_ids": ["luad_tcga_pan_can_atlas_2018"]
    }
  ],
  "commands_used": [
    "biocli aggregate tumor-gene-dossier TP53 --study luad_tcga_pan_can_atlas_2018 -f json"
  ],
  "web_queries": [],
  "warnings": [],
  "errors": [],
  "recovery_actions": [],
  "runtime": {
    "wall_clock_ms": 0,
    "tool_calls": 0
  }
}
```

Rules:

- `status` must be one of `completed`, `partial`, `failed`
- `final_answer.result` should stay structured JSON, not free-form prose
- `sources` must cite concrete databases, URLs, or article identifiers
- `commands_used` must list exact terminal commands when commands were used
- `recovery_actions` should record retries, fallback searches, and parameter fixes
- validate artifacts against [output.schema.json](output.schema.json) before scoring

## Run Protocol

1. Use the same task list for both arms.
2. Randomize task order per run.
3. Run at least 3 repeats per task per arm.
4. Keep model, temperature, and time budget identical across arms.
5. For write-capable tasks, require both arms to stay in preview or dry-run mode.
6. Save full transcripts, raw tool outputs, and final JSON artifacts.

Recommended folders:

```text
benchmarks/agent-ab/results/YYYY-MM-DD/
  raw/
    agent_with_biocli/
    agent_without_biocli/
  scored/
```

Validation helpers:

- `npm run bench:agent-ab:clean`
- `npm run bench:agent-ab:validate`

`bench:agent-ab:validate` enforces a core benchmark contract and reports stricter source-shape drift as warnings. Use it before scoring.
It also validates `scorecard.csv`, `scoring-manifest.json`, rubric version, score ranges, and optional evidence-review linkage. Known malformed repeat-001 artifacts are reported from [known-core-failures.json](known-core-failures.json) without allowing new contract failures.

## First Pilot

Use [first-run.tasks.yaml](first-run.tasks.yaml) for the first lightweight evaluation.
Use [first-run.prompts.md](first-run.prompts.md) for the standardized task prompt text.
Use [first-run.execution.md](first-run.execution.md) and [results/2026-04-15/run-matrix.csv](results/2026-04-15/run-matrix.csv) as the concrete operator checklist and file-naming plan.

Pilot size:

- `6` tasks
- `3` repeats per arm
- one model
- one environment

Recommended first pilot tracks:

- retrieval
- aggregation
- cohort
- recovery
- batch

Use [scorecard.template.csv](scorecard.template.csv) and [scoring-manifest.template.json](scoring-manifest.template.json) as the operational scoring seed. Use [evidence-review.template.csv](evidence-review.template.csv) for the independent biological/source/safety review.

## Recommended Headline Metrics

Report these first:

- task completion rate
- factual accuracy on completed runs, only after independent review
- source-backed answer rate, only after independent review
- median time to first correct result
- recovery success rate after initial failure

Do not collapse everything into a single universal winner score.

## Interpretation

If `agent_with_biocli` wins mainly on:

- multi-database aggregation
- identifier-heavy tasks
- workflow planning
- failure recovery

then the conclusion is strong: `biocli` is adding operational value, not just convenience.

If both arms tie on:

- simple gene lookup
- basic literature search
- common factual questions

that is also useful. It means those tasks should not be your primary product proof point.
