# Agent A/B scoring rubric

Rubric version: `agent-ab-v1`

This is the canonical scoring contract for new `benchmarks/agent-ab` runs. The 2026-04-12 pilot used a legacy `0–100 × 6` rubric and is historical evidence only; its numbers must not be combined with `agent-ab-v1` results.

## Headline rule

Do not publish one blended winner score. Report:

1. completion status and rate;
2. each operational score by task/arm;
3. runtime and tool-call measurements separately;
4. evidence-review status and results;
5. recovery outcomes for runs that actually encountered failure.

## Operational scores

Each run receives five integer scores from `0` to `2`:

- `0`: failed or unusable
- `1`: partial, degraded, indirect, or manually repairable
- `2`: successful and reusable

### 1. Completion

- `2`: all requested outputs are present and usable
- `1`: a material component is missing or degraded, but the result remains useful
- `0`: the requested task was not completed

The score must agree with run status: `failed` implies `0`; `partial` cannot receive `2`.

### 2. Structure

- `2`: output follows the benchmark object contract with stable, clearly named fields
- `1`: output is mostly structured but requires normalization or mixes important prose into fields
- `0`: output is primarily unstructured or violates the required top-level shape

### 3. Parseability

- `2`: the saved final artifact parses without repair and downstream fields are directly addressable
- `1`: a deterministic, small repair is needed
- `0`: parsing fails or the requested data cannot be extracted reliably

### 4. Recovery

- `2`: no repair was needed, or a failure was detected and recovered cleanly without human intervention
- `1`: the run completed after an avoidable detour, partial fallback, or manual repair
- `0`: failure was ignored, hallucinated around, or not recovered

Always retain the raw `recovery_needed` and `recovery_succeeded` fields. Recovery rate must be calculated only over runs where `recovery_needed=yes` rather than inferred from this score.

### 5. Efficiency

- `2`: direct path with low tool/runtime burden for the task class
- `1`: moderate extra calls, searches, retries, or setup
- `0`: substantial thrashing, cap-like timeout, or disproportionate operator burden

Use observed transcript/tool behavior when runtime metadata is missing or invalid, and disclose that substitution in notes. Do not silently treat `wall_clock_ms=0` as instant execution.

## Independent evidence reviews

Factual accuracy, source verifiability, and safety are essential but are not folded into the five operational scores. They require a separate review file so operational convenience cannot compensate for a biological error.

Allowed review values are:

- factual accuracy: `pass`, `partial`, `fail`, `unreviewed`
- source verifiability: `pass`, `partial`, `fail`, `unreviewed`
- safety: `pass`, `fail`, `not_applicable`, `unreviewed`

Use `evidence-review.template.csv` and key every review to `run_id`. A scored set may exist with reviews marked incomplete, but then it must not publish factual-accuracy, source-backed-rate, or safety claims.

Accuracy review should check the requested entity, identifiers, disease/study context, and material biological claims against the cited primary databases or literature. Source review should check record-level identifiers or stable URLs, not merely the presence of a source label.

For write-capable tasks, safety review records whether the run stayed within the prompt's authorized output scope and made intended artifacts clear.

## Scored-set manifest

Every current scored directory containing `scorecard.csv` must also contain `scoring-manifest.json` with:

- `rubricVersion: "agent-ab-v1"`
- the five operational dimensions
- scale minimum/maximum
- scorecard filename
- evidence-review status and optional filename

`npm run bench:agent-ab:validate` checks the raw output contract, scorecard values, manifest, and evidence-review linkage.

## Reporting and interpretation

For each task and arm, retain:

- five operational scores and reviewer notes
- raw transcript and final artifact paths
- runtime/tool-call measurements
- failure and recovery actions
- independent evidence review when completed

A generic-web arm tying on simple retrieval tasks is not a failure for `biocli`. A `biocli` advantage on batch execution, artifact production, recovery, and identifier-heavy aggregation is product evidence, but it is not evidence that the model became more intelligent or that biological accuracy improved.
