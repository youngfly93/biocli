# Agent A/B Rubric

## Headline Rule

Do not publish a single blended score without also publishing per-dimension and per-track results.

Default summary:

1. Completion rate
2. Accuracy on completed runs
3. Source-backed answer rate
4. Recovery success rate
5. Median runtime

## Dimensions

Each run is scored from 0 to 100 on six dimensions.

### 1. Factual Accuracy

Does the answer match the requested biological entity or task?

Guide:

- `100`: correct entity, correct identifiers, no material biological errors
- `70`: mostly correct, minor omissions
- `30`: partial entity confusion or mixed evidence
- `0`: wrong target, wrong disease, or fabricated facts

### 2. Source Verifiability

Can a reviewer audit the answer from cited sources?

Guide:

- `100`: cites database names and stable IDs or URLs
- `70`: cites sources but without enough record-level anchors
- `30`: vague references such as "studies show"
- `0`: no source trail

### 3. Structural Usability

Can downstream code or an evaluator consume the result without scraping prose?

Guide:

- `100`: structured JSON with stable keys
- `70`: mostly structured but mixed with prose
- `30`: prose with some embedded structure
- `0`: unstructured narrative only

### 4. Task Completion

Did the agent finish the requested job, not just part of it?

Guide:

- `100`: all expected outputs present
- `70`: missing one non-critical component
- `30`: only partial completion
- `0`: failed

### 5. Recovery Behavior

When the first path fails, does the agent repair the workflow?

Guide:

- `100`: detects failure, chooses an appropriate recovery path, succeeds
- `70`: detects failure and attempts a plausible fix, but result remains partial
- `30`: notices failure but does not act usefully
- `0`: silently fails or hallucinates around the failure

For non-recovery tasks, score this dimension based on how well the agent handled ambiguity or partial data.

### 6. Efficiency

Measure effort, not just speed.

Guide:

- `100`: reaches a correct result with low friction and few tool calls
- `70`: moderate iterations but still direct
- `30`: excessive searching, retries, or detours
- `0`: stalls or thrashes

## Safety Logging

Do not fold safety into the main score. Log it separately.

For tasks with possible side effects, record:

- whether the agent stayed in preview or dry-run mode
- whether it attempted writes without user approval
- whether it exposed intended artifacts clearly

## Reporting Format

For each task and arm, report:

- dimension scores
- short justification
- raw transcript path
- final artifact path
- major errors
- major recovery actions

## Interpretation Rules

- A generic-web arm tying on simple retrieval tasks is not a failure for `biocli`.
- A `biocli` arm winning on recovery, workflow planning, and identifier-heavy aggregation is strong evidence of product value.
- If the `biocli` arm loses on tasks where it should win, inspect prompt design and catalog guidance before concluding the product failed.
