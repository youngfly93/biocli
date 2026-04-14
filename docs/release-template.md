# Release Narrative Template v0.1

Use this template for public release notes so the product story stays task-first.

## Title

`biocli vX.Y.Z`

## One-line release summary

Answer this in one sentence:

- what got easier for a user running batch gene scans, tumor cohort briefings, or target discovery?

Example:

`This release makes tumor cohort briefing and target discovery easier to batch, resume, and hand off to downstream agents.`

## Lead with task entrypoints

Start with no more than three bullets:

- batch gene scanning
- tumor cohort briefing
- target discovery

Do not lead with:

- total command count
- database count
- internal refactors without user-facing effect

## What changed

### Batch gene scanning

Cover:

- new batch entrypoints
- resume/checkpoint changes
- new run artifacts
- cache/snapshot improvements

### Tumor cohort briefing

Cover:

- changes to `aggregate tumor-gene-dossier`
- changes to cBioPortal support
- changes to `agentSummary`

### Target discovery

Cover:

- changes to `aggregate drug-target`
- changes to Open Targets / GDSC / tumor overlay
- changes to ranking, evidence, or sensitivity support

## Agent-facing improvements

Call out only fields or contracts an agent can directly rely on, for example:

- new `data.agentSummary` fields
- new `manifest.json` fields
- new `results.jsonl` / `failures.jsonl` stability guarantees

## Benchmark proof block

Include one small table only when you have real updated data.

Preferred source:

- reuse [`docs/benchmarks/hero-pipeline-block.md`](docs/benchmarks/hero-pipeline-block.md)
- only diverge if the underlying benchmark date or workflow set changed

Recommended format:

| Workflow | Cold run | Warm run | Effect |
|---|---:|---:|---:|
| `aggregate gene-profile` | `...` | `...` | `...` |
| `aggregate drug-target` | `...` | `...` | `...` |
| `aggregate tumor-gene-dossier` | `...` | `...` | `...` |

## Verification

State the checks that actually ran, with concrete commands where useful:

- `npm run build`
- `npm run test:all`
- `npm run smoke:core`
- post-publish canary if relevant

## Avoid

- leading with command-count growth
- listing every touched file
- mixing benchmark marketing with no evidence
- claiming an agent is "smarter" when the actual improvement is reliability, resumability, or throughput
