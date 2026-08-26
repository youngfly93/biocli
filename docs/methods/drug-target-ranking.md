# `aggregate drug-target` ranking method

Method version: `biocli-drug-target-ranking-v1`

Implementation source: `src/clis/aggregate/drug-target.ts`

## Intended use

The ranking orders drug candidates for target-triage review. It combines clinical stage, disease/study text alignment, report metadata, approved indications, and optional GDSC sensitivity support.

The score is a deterministic product heuristic. It is not a probability, an efficacy estimate, a regulatory conclusion, or a clinical evidence grade. Candidates and source records must be reviewed before biological or clinical interpretation.

## Versioning rule

The method version is returned in:

- `data.summary.rankingMethodVersion`
- `data.candidates[].ranking.methodVersion`

Any change to stage values, phrase-match values, weights, caps, penalties, tie-breakers, or evidence selection must:

1. bump the method version;
2. update this document;
3. update deterministic regression fixtures;
4. state the ranking change in release notes.

Presentation-only changes do not require a method-version bump. In particular, `--report-limit` controls the number of returned report links but does not change evidence used for ranking.

## Score components

The final score is rounded to two decimal places:

```text
clinicalStage
+ diseaseMatch
+ diseaseSpecificity
+ studyMatch
+ geneMatch
+ reportEvidence
+ approvedIndicationMatch
+ sourceQuality
+ recency
+ sensitivity
- diseaseContextBreadthPenalty
- approvedIndicationBreadthPenalty
```

Every value is exposed under `data.candidates[].ranking.components` so a consumer can audit the calculation.

| Component | Definition |
|---|---|
| `clinicalStage` | Stage value divided by `10` |
| `diseaseMatch` | Best disease phrase score × `1.5` |
| `diseaseSpecificity` | Best specificity score × `0.35` |
| `studyMatch` | Best tumor-study phrase score × `1.2` |
| `geneMatch` | Best gene phrase score in report titles × `0.9` |
| `reportEvidence` | Unique returned source reports, capped at `3` |
| `approvedIndicationMatch` | Best approved-indication phrase score × `0.2` |
| `sourceQuality` | Sum of distinct source weights, capped at `2.5` |
| `recency` | `max(latestYear − 2021, 0) × 0.15`, capped at `0.9` |
| `sensitivity` | Optional GDSC support component described below |
| `diseaseContextBreadthPenalty` | `log2(contextCount) × 0.28` when count > 1, capped at `1.1` |
| `approvedIndicationBreadthPenalty` | `log2(indicationCount) × 0.24` when count > 2, capped at `1.35` |

### Clinical stages

| Stage | Value |
|---|---:|
| `APPROVAL` | 60 |
| `PHASE_4` | 50 |
| `PHASE_3` | 40 |
| `PHASE_2` | 30 |
| `PHASE_1_2` | 25 |
| `PHASE_1` | 20 |
| `EARLY_PHASE_1` | 15 |
| `PHASE_0` | 10 |
| `PRECLINICAL` | 5 |
| `UNKNOWN` | 0 |

### Phrase matching

Text is lower-cased, punctuation-normalized, and tokenized before matching.

| Match | Raw value |
|---|---:|
| Exact normalized phrase | 12 |
| Candidate contains a multi-token term | 10 |
| Term contains a multi-token candidate | 8 |
| Multi-token overlap | 7 |
| Candidate contains a single token of at least four characters | 7 |
| Term contains a single-token candidate of at least four characters | 5 |
| Strong single-token overlap | 4 |
| Weak single-token overlap of at least four characters | 3 |

Disease specificity adds `1.25` for an ontology-backed disease context or `0.35` for text-only context, plus `0.18` per context token up to six tokens. The best matching context is used.

### Clinical source weights

The source-quality component counts each distinct source once, regardless of how many reports that source contributes.

| Source | Weight |
|---|---:|
| FDA | 1.2 |
| EMA Human Drugs | 1.1 |
| EMA | 1.0 |
| DailyMed | 1.0 |
| PMDA | 0.9 |
| AACT | 0.6 |
| ATC | 0.4 |
| Other source | 0.25 |

These weights express routing priority and source directness in this product; they do not constitute a formal evidence hierarchy.

### GDSC sensitivity component

`aggregate drug-target` reads GDSC only from an already-installed local
snapshot. It does not download bulk workbooks during a target query. Install
the optional snapshot explicitly with `biocli gdsc prewarm`; when it is absent
or incomplete, the result carries a warning, omits the sensitivity component,
and reports partial completeness. This acquisition policy does not change the
score produced from the same installed snapshot.

When a candidate can be linked to the local GDSC index, the component is:

```text
min(max(-bestZScore, 0), 4)
+ min(datasetCount, 2) × 0.8
+ min(measurementCount, 10) × 0.1
+ tissue bonus
```

The tissue bonus is `1.5` when tissues match the disease/study context, `0.5` for an unfiltered dataset-wide match, and `0` otherwise.

## Evidence selection and ordering

- Disease contexts are normalized and semantically compacted before scoring.
- All unique clinical reports returned by Open Targets are used for ranking and source counts.
- `--report-limit` affects only the report links included in the response.
- Candidate output is sorted by score, clinical stage, approved-indication count, evidence-source report count, disease-context count, total ranking report count, then drug name.
- `ranking.evidenceReportCount` records the full report count used by the method.

## Known limitations

- Text matching does not replace ontology reasoning and can miss aliases or merge related but non-equivalent disease phrases.
- Report availability and source coverage differ across drugs.
- GDSC cell-line sensitivity is preclinical evidence and does not imply patient benefit.
- The fixed 2021 recency baseline will need an explicit versioned revision rather than a silent calendar-dependent change.
- Scores are meaningful for ordering candidates within one run; they should not be compared as calibrated measurements across unrelated targets or method versions.
