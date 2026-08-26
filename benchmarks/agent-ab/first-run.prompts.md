# First-Run Standard Prompts

Use this file with:

- [first-run.tasks.yaml](first-run.tasks.yaml)
- [prompts.md](prompts.md)
- [scorecard.template.csv](scorecard.template.csv)

These prompts are designed for the first lightweight A/B pilot.

They should be used identically across both arms except for the arm-specific policy text in [prompts.md](prompts.md).

## Shared Operator Rules

Prepend the relevant arm policy from [prompts.md](prompts.md), then append one of the task prompts below.

For every run:

- do not read `biocli` source code or internal design docs
- do not ask for extra clarification unless the task is impossible without it
- prefer structured JSON in the final output
- do not fabricate identifiers, study IDs, or citations
- if an attempted path fails, record the failure and try one reasonable recovery step
- for batch/workflow tasks, stay in preview or dry-run mode unless writing artifacts is explicitly part of the task

## Final Output Requirement

Each run should end with one JSON object using this shape:

```json
{
  "task_id": "<task-id>",
  "arm": "<agent_with_biocli|agent_without_biocli>",
  "status": "<completed|partial|failed>",
  "final_answer": {
    "summary": "brief human-readable answer",
    "result": {}
  },
  "sources": [],
  "commands_used": [],
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

For `sources`, use this stricter shape:

```json
[
  {
    "label": "cBioPortal",
    "url": "https://www.cbioportal.org/api/studies/luad_tcga_pan_can_atlas_2018",
    "record_ids": ["luad_tcga_pan_can_atlas_2018"]
  }
]
```

Rules:

- use `label`, not `name`, `title`, or `source`
- use `record_ids`, not `id`, `identifier`, or `record_id`
- keep explanatory notes in `warnings` or markdown notes, not inside `sources`

## Task 1: `gene-dossier-tp53`

```text
Task ID: gene-dossier-tp53

Prepare a structured TP53 gene dossier.

Requirements:
- Resolve TP53 to a canonical gene entity.
- Include at least one stable identifier.
- Include a concise functional summary.
- Include pathway context.
- Include at least one interaction or network clue.
- Include clinically relevant variant context.

Constraints:
- Return structured JSON in final_answer.result.
- Cite concrete sources with record IDs or URLs when available.
- Do not pad the answer with general textbook prose.

Success condition:
- A downstream reviewer or agent can use your result as a compact TP53 briefing without additional lookup.
```

## Task 2: `drug-target-egfr`

```text
Task ID: drug-target-egfr

Find whether EGFR is a viable drug target in lung cancer.

Requirements:
- Resolve EGFR to the correct target entity.
- Return a concise machine-readable summary of disease links, targetability or tractability, and candidate drugs.
- Include evidence that supports why the top candidate or candidates are relevant to lung cancer.
- Prefer a structured shortlist over a long narrative report.

Constraints:
- Return structured JSON in final_answer.result.
- Keep the answer focused on target triage, not broad oncology background.
- Cite concrete sources with stable identifiers or URLs.

Success condition:
- A downstream user can immediately see whether EGFR is targetable in lung cancer and which candidate drugs are most relevant.
```

## Task 3: `tumor-gene-dossier-tp53-luad`

```text
Task ID: tumor-gene-dossier-tp53-luad

Find TP53 mutation and prevalence context in a real lung adenocarcinoma cohort.

Use this study hint:
- luad_tcga_pan_can_atlas_2018

Requirements:
- Return the study identifier you actually used.
- Report alteration or mutation prevalence for TP53 in that cohort.
- Include representative alterations or exemplar protein changes.
- Include at least one co-mutation clue.
- Keep the result structured and concise.

Constraints:
- Return structured JSON in final_answer.result.
- If the hinted study is unavailable, repair the path and note what you used instead.
- Cite concrete sources with stable identifiers or URLs.

Success condition:
- A downstream reviewer can use the result as a compact TP53 tumor-cohort briefing for LUAD.
```

## Task 4: `recovery-invalid-study-cbioportal`

```text
Task ID: recovery-invalid-study-cbioportal

You are first given this invalid study id:
- bogus_study

Recover from that failure and produce a valid TP53 tumor-cohort result for a real lung adenocarcinoma study.

Requirements:
- Acknowledge that the provided study id is invalid.
- Perform a repair step to find a valid lung adenocarcinoma study.
- Re-run the analysis with the corrected study.
- Return a structured final result with study identifier, prevalence, and at least one mutation or co-mutation clue.

Constraints:
- Record the failed step and the recovery action.
- Return structured JSON in final_answer.result.
- Do not invent a study identifier.

Success condition:
- The run demonstrates explicit recovery behavior and still produces a usable tumor-cohort result.
```

## Task 5: `batch-drug-target-lung-panel`

```text
Task ID: batch-drug-target-lung-panel

Given the following lung-focused gene panel:
- EGFR
- ERBB2
- PIK3CA
- MET
- ALK

Run a target triage and return outputs suitable for downstream ranking and filtering.

Requirements:
- Produce a machine-readable multi-gene result.
- Return a shortlist of top targets or top drug candidates across the panel.
- If artifacts are generated, mention the artifact paths and what they are for.
- Prefer a batch-style execution path when available rather than five unrelated one-off runs.

Constraints:
- Return structured JSON in final_answer.result.
- Do not perform unsafe writes outside the intended task workspace.
- Keep the final answer focused on reusable outputs, not verbose prose.

Success condition:
- A downstream user can take the result or artifacts and immediately filter or rank the panel.
```

## Task 6: `batch-gene-profile-panel`

```text
Task ID: batch-gene-profile-panel

Given the following candidate gene panel:
- TP53
- BRCA1
- EGFR
- PIK3CA
- NF1

Produce a machine-readable batch profile suitable for downstream pathway or interaction triage.

Requirements:
- Return a multi-gene structured result.
- Include enough information to support downstream ranking or filtering.
- If artifacts are generated, mention the artifact paths and what they contain.
- Prefer a batch-style execution path when available rather than repeated single-gene manual work.

Constraints:
- Return structured JSON in final_answer.result.
- Keep the answer concise and execution-focused.
- Do not replace structured outputs with a narrative-only summary.

Success condition:
- A downstream user can use the result to decide which genes deserve deeper pathway or interaction follow-up.
```
