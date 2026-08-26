# Scored Outputs

This directory stores scored pilot outputs.

Use:

- [scorecard.csv](scorecard.csv) for per-run operational scoring
- [scoring-manifest.json](scoring-manifest.json) for rubric and review status
- [summary.md](summary.md) for headline findings

## Scoring Rule

Use the `agent-ab-v1` `0-2` scale defined in the canonical [rubric](../../../rubric.md):

- `0`: failed or unusable
- `1`: partial or manually repairable
- `2`: successful and reusable

Recommended scored dimensions:

- `completion`
- `structure`
- `parseability`
- `recovery`
- `efficiency`

Do not collapse the pilot into one universal number without keeping per-task notes.

Factual accuracy, source verifiability, and safety have not yet received a separate evidence review for this scored set. Do not infer those claims from the operational scores.
