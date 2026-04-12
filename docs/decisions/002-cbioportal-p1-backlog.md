# 002: cBioPortal P1 Backlog

## Decision

P1 should prioritize `cBioPortal` and tumor-focused aggregation instead of
continuing to expand MCP surface area. MCP stays in maintenance mode; product
energy shifts to higher-value cancer genomics workflows.

## Why

- MCP is now a thin access layer, not the product moat.
- cBioPortal gives biocli a strong tumor genomics data foundation.
- `drug-target` and future tumor dossiers need study, profile, mutation, and
  sample-list primitives before they can become reliable aggregate commands.

## Phase 1: Foundation

- Add `cbioportal` database backend.
- Add atomic commands:
  - `cbioportal studies`
  - `cbioportal profiles`
  - `cbioportal mutations`
- Validate real packaging/build/test coverage after introducing the new backend.

## Phase 2: Tumor Summaries

- Implemented: `cbioportal frequency` for study-level alteration summaries.
- Implemented: `cbioportal co-mutations` for pairwise gene overlap inside a study.
- Implemented: structured provenance defaults for cBioPortal study/profile/mutation
  records.

## Phase 3: Hero Workflow

- Implemented: `aggregate tumor-gene-dossier <gene> --study <study>`
- Merge:
  - cBioPortal mutation prevalence and exemplar variants
  - Open Targets target/disease evidence
  - existing UniProt / PubMed / ClinVar layers where relevant

## Phase 4: Target-Therapy Layer

- Implemented: `opentargets` backend for target search, tractability, disease
  evidence, and target-linked drug candidates.
- Implemented: `aggregate drug-target <gene> [--disease <term>]`
- Implemented: optional `--study` cBioPortal tumor overlay for prevalence,
  exemplar variants, and co-mutations
- Implemented: study-aware ranking beyond naive disease substring filtering
- Implemented: GDSC-backed sensitivity evidence with local prewarm/refresh flow
- Current scope:
  - target resolution by HGNC symbol / Ensembl ID
  - tractability summary
  - top associated diseases
  - candidate drugs with clinical stage, disease context, and evidence links
  - optional tumor-study overlay from cBioPortal
  - GDSC sensitivity evidence and strongest cell-line hits
- Next extension points:
  - additional sensitivity datasets beyond GDSC
  - tumor-aware candidate ranking beyond disease/study/text evidence

## Phase 5: Gene-Set Comparison Layer

- Implemented: `aggregate compare-genes <genes>`
- Current scope:
  - shared KEGG pathways across the input genes
  - STRING interaction subnetwork across the input genes
  - shared vs gene-specific GO terms from UniProt
  - pairwise overlap matrix across pathways / GO / STRING edges
  - set-level GO enrichment via Enrichr

## Acceptance

- Users can discover a study, inspect its molecular profiles, and fetch
  mutation rows for a gene without leaving biocli.
- Users can query `aggregate drug-target` and receive a structured, provenance-
  carrying Open Targets summary without hand-crafting GraphQL requests.
- Users can pass `--study` to overlay cBioPortal prevalence and co-mutation
  context onto the same target-centric result.
- New commands are available through CLI, manifest, and MCP without custom glue.
