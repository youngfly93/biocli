# Hero Workflow `agentSummary` Contract v0.1

## Purpose

This document defines the machine-facing summary contract for hero workflows.

It exists to solve a real ambiguity in the current product:

- many commands already use `summary` to mean counts, stats, or local run metadata
- hero workflows now need a separate contract optimized for downstream agent consumption

To avoid breaking or overloading existing `summary` fields, the canonical machine-facing layer for hero workflows is:

- `agentSummary`

## Scope

This contract applies first to:

- `aggregate gene-profile`
- `aggregate drug-target`
- `aggregate tumor-gene-dossier`

Future hero workflows may adopt the same pattern if they expose large nested reports.

## Naming Decision

Use:

- `data.agentSummary`

Do not reuse:

- `data.summary`

Reason:

- `data.summary` is already overloaded in the codebase
- some commands use it for counts or operational stats
- reusing it for a new cross-workflow contract would create migration ambiguity for agents and scripts

## Contract Goals

`agentSummary` should be:

- smaller than the full report
- flatter than the full report
- stable across releases
- sufficient for first-pass agent decisions
- explicit about uncertainty and next actions

`agentSummary` is not intended to replace the full report.

The full report remains the source of detail and provenance-rich drill-down.

## Cross-Workflow Required Fields

Every hero workflow `agentSummary` must include:

- `topFinding`
- `warnings`
- `completeness`
- `recommendedNextStep`

### `topFinding`

Type:

- `string`

Meaning:

- one sentence that captures the highest-value conclusion from the workflow

Rules:

- concise
- grounded in the returned data
- suitable for direct display or agent handoff

### `warnings`

Type:

- `string[]`

Meaning:

- summary-level non-fatal caveats the agent should know before acting on the result

Rules:

- may be empty
- should not duplicate the entire top-level `warnings` array unless the item is decision-relevant

### `completeness`

Type:

- `'complete' | 'partial' | 'degraded'`

Meaning:

- whether the workflow result is complete enough for normal downstream use

Rules:

- mirrors the top-level completeness vocabulary
- never use booleans for this field

### `recommendedNextStep`

Type:

- object

Required fields:

- `type`
- `rationale`

Optional fields:

- `command`
- `focus`

Recommended shape:

```json
{
  "type": "inspect-candidate",
  "command": "biocli aggregate drug-target EGFR --disease lung --study luad_tcga_pan_can_atlas_2018 -f json",
  "focus": "Review the top candidate's approval stage and tumor overlay.",
  "rationale": "The top candidate is supported by both disease context and tumor-cohort evidence."
}
```

## Workflow-Specific Fields

### `aggregate gene-profile`

Required fields:

- `topPathways`
- `topInteractionPartners`
- `topDiseaseLinks`

Suggested shape:

```json
{
  "topFinding": "TP53 profile highlights top pathway p53 signaling pathway, top interaction partner MDM2, disease link Li-Fraumeni syndrome.",
  "topPathways": [
    {
      "id": "hsa04115",
      "name": "p53 signaling pathway",
      "source": "KEGG"
    }
  ],
  "topInteractionPartners": [
    {
      "partner": "MDM2",
      "score": 0.998
    }
  ],
  "topDiseaseLinks": [
    {
      "id": "ds:H00096",
      "name": "Li-Fraumeni syndrome",
      "source": "KEGG"
    }
  ],
  "warnings": [],
  "completeness": "complete",
  "recommendedNextStep": {
    "type": "inspect-profile",
    "rationale": "The profile already exposes pathway, interaction, or disease signals worth deeper inspection."
  }
}
```

### `aggregate drug-target`

Required fields:

- `topCandidates`
- `matchedDisease`
- `tumorContext`
- `topSensitivitySignals`

Suggested shape:

```json
{
  "topFinding": "EGFR has approved and investigational candidates relevant to lung cancer, led by Afatinib Dimaleate.",
  "topCandidates": [
    {
      "drugName": "AFATINIB DIMALEATE",
      "chemblId": "CHEMBL2105712",
      "maxClinicalStage": "APPROVAL",
      "score": 20.5,
      "reasons": [
        "disease match",
        "approval-stage evidence",
        "supported by GDSC sensitivity"
      ]
    }
  ],
  "matchedDisease": "lung",
  "tumorContext": {
    "studyId": "luad_tcga_pan_can_atlas_2018",
    "mutationFrequencyPct": 12.37,
    "alteredSamples": 70,
    "totalSamples": 566
  },
  "topSensitivitySignals": [
    {
      "drugName": "AFATINIB DIMALEATE",
      "dataset": "GDSC2",
      "tissue": "LUAD"
    }
  ],
  "warnings": [],
  "completeness": "complete",
  "recommendedNextStep": {
    "type": "inspect-candidate",
    "rationale": "The top candidate is already approval-stage and aligned with the disease filter."
  }
}
```

### `aggregate tumor-gene-dossier`

Required fields:

- `prevalence`
- `topCoMutations`
- `exemplarVariants`
- `cohortContext`

Suggested shape:

```json
{
  "topFinding": "TP53 is altered in 19.78% of samples in the selected study and co-occurs most strongly with known driver partners.",
  "prevalence": {
    "studyId": "acc_tcga_pan_can_atlas_2018",
    "mutationFrequencyPct": 19.78,
    "alteredSamples": 18,
    "totalSamples": 91
  },
  "topCoMutations": [
    {
      "partnerGene": "KRAS",
      "coMutatedSamples": 5,
      "coMutationRateInAnchorPct": 27.78
    }
  ],
  "exemplarVariants": [
    {
      "proteinChange": "p.R175H",
      "sampleCount": 3,
      "mutationType": "Missense_Mutation"
    }
  ],
  "cohortContext": {
    "studyId": "acc_tcga_pan_can_atlas_2018",
    "molecularProfileId": "acc_tcga_pan_can_atlas_2018_mutations",
    "sampleListId": "acc_tcga_pan_can_atlas_2018_all"
  },
  "warnings": [],
  "completeness": "complete",
  "recommendedNextStep": {
    "type": "inspect-cohort-context",
    "rationale": "The prevalence and co-mutation profile justify deeper cohort-specific review."
  }
}
```

## Compatibility Rules

- Existing nested report structures stay available.
- Existing command-local `summary` objects are not removed just to introduce `agentSummary`.
- Agents should be able to consume `agentSummary` first, then drill into the full report only when needed.

## Schema Guidance

When this contract is implemented in code:

- `agentSummary` should be explicitly represented in JSON Schema
- hero workflow tests should assert field presence and stable naming
- docs examples should parse `agentSummary` before the full report body

## Open Questions

- Should `recommendedNextStep.command` be required when the next action is a specific `biocli` command?
- Should `agentSummary` be returned by default or only in hero workflows?
- Should `summary.csv` mirror `agentSummary` fields exactly, or remain a separate flattened spreadsheet view?
