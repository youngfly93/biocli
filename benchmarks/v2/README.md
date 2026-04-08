# Benchmark V2 Public-Lite Bundle

This folder is the frozen public review bundle for benchmark v2 as executed on `2026-04-08`.

It keeps the benchmark small enough for external review while preserving the artifacts needed to audit the published claims:

- [rubric.md](rubric.md)
- [tasks.yaml](tasks.yaml)
- [capability_matrix.frozen.csv](capability_matrix.frozen.csv)
- [artifact_index.md](artifact_index.md)
- [public_report.md](runs/report-public-stable/public_report.md)
- [public_summary.json](runs/report-public-stable/public_summary.json)
- [public-core-x3-stable/manifest.json](runs/public-core-x3-stable/manifest.json)
- [public-workflow-x3-stable/manifest.json](runs/public-workflow-x3-stable/manifest.json)

Interpretation rules:

- Coverage and quality are reported separately.
- Core and workflow are reported separately.
- Quality scores in the public report reflect executed stable cells only, not every theoretically supported task.
- The frozen capability matrix is the authoritative source for support-state claims.
- Stable run bundles retain per-task `stdout/stderr/result/normalized/score` artifacts, while transient runtime caches have been stripped.

This bundle intentionally excludes internal smoke runs, pilots, temporary directories, and exploratory runner attempts.
