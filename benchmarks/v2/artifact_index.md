# Artifact Index

This index describes the audit artifacts intentionally retained in the public-lite bundle.

## Stable Manifests

- [runs/public-core-x3-stable/manifest.json](runs/public-core-x3-stable/manifest.json)
- [runs/public-workflow-x3-stable/manifest.json](runs/public-workflow-x3-stable/manifest.json)

Both manifests have been normalized for portability:

- `run_dir` and `score_path` now use bundle-relative paths
- scorecard paths are bundle-relative file names

## Scorecards

- [runs/public-core-x3-stable/core_scorecard.json](runs/public-core-x3-stable/core_scorecard.json)
- [runs/public-workflow-x3-stable/workflow_scorecard.json](runs/public-workflow-x3-stable/workflow_scorecard.json)

## Per-Task Audit Files

Stable task artifacts remain under these trees:

- `runs/public-core-x3-stable/r01..r03/<tool>/<task>/`
- `runs/public-workflow-x3-stable/r01..r03/<tool>/<task>/`

Each retained task directory may contain:

- `step-01.stdout.txt`
- `step-01.stderr.txt`
- `result.json`
- `normalized.json`
- `score.json`
- `adjudication.json` when manual or rule-based adjudication was needed

## Intentionally Removed

The public-lite bundle strips transient and non-audit files, including:

- `_runtime/` caches
- `tmp*` directories
- `smoke*` directories
- `pilot*` directories
- AppleDouble `._*` files
