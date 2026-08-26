# cBioPortal cancer-context candidate reference

Reference ID: `biocli-cancer-gene-context-v1`

Implementation source: `src/reference-data/cancer-gene-context-v1.ts`

## Purpose

The reference bounds cBioPortal co-mutation retrieval to 172 human genes so a
workflow does not scan roughly 20,000 genes. It is a product retrieval
heuristic seeded from the project's earlier COSMIC/TCGA-oriented list.

Membership is not independent evidence that a gene is a cancer driver, does
not establish functional synergy, and must not be used as a clinical claim.
The response label `known_driver` is retained for output compatibility; its
note identifies the reference and states this limitation.

## Identity safety

Every row stores the current human gene symbol together with its Entrez Gene
ID. A context label is applied only when both values match. This prevents a
valid but unrelated ID from inheriting the intended gene's annotation.

The v1 identities were validated against NCBI Gene on 2026-08-26. Re-run the
live check with:

```bash
npm run validate:cancer-gene-context
```

The offline regression suite also locks uniqueness, the corrected identities,
and the `LPA`/`LRP1B` failure case.

## Maintenance rule

- Correct symbol/ID nomenclature drift against NCBI Gene and add a regression.
- Bump the reference ID when membership or intended scientific scope changes.
- Record the source snapshot or selection rationale for any newly added gene.
- Do not silently broaden the compatibility label into a biological or
  clinical conclusion.
