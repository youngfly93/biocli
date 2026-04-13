# Agent A/B Benchmark

This benchmark measures whether `biocli` improves agent performance on real bioinformatics tasks.

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

Score each run on six dimensions:

1. Factual accuracy
2. Source verifiability
3. Structural usability
4. Task completion
5. Recovery behavior
6. Efficiency

Safety should be logged separately for write-capable tasks.

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

## Recommended Headline Metrics

Report these first:

- task completion rate
- factual accuracy on completed runs
- source-backed answer rate
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
