# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.4.0] - 2026-04-08

First public-facing release with full repository metadata, a deprecation
path for the legacy `ncbicli` binary, and a refreshed benchmark labeled
against the actually-published code.

### Added
- `package.json` now declares `author`, `repository`, `homepage`, and
  `bugs` so the npm and GitHub package pages render with the right links.
- Stderr deprecation notice when biocli is invoked via the legacy
  `ncbicli` binary. Set `BIOCLI_NO_DEPRECATION=1` to silence. The notice
  is suppressed during shell completion (`--get-completions`) so
  completion candidates stay parseable.
- `CHANGELOG.md` (this file).
- First curated GitHub Release.

### Changed
- All documentation references to the planning placeholder `@biocli/cli`
  are now `@yangfei_93sky/biocli` — affects RELEASE_CHECKLIST.md,
  PLUGIN_DEV.md, the registry-api JSDoc, ADR-001, and the benchmark
  install line in `tasks.yaml`.
- Benchmark refreshed against `biocli 0.3.9 / biomcp 0.8.19 / gget 0.30.3`
  on 2026-04-08. Scored capabilities are unchanged versus the 2026-04-04
  baseline; this is a re-run for honest version labeling, not a
  re-evaluation. biocli scored 97/100 (was 96 against 0.2.0; +1 from
  gene-02 hitting all four criteria after the network-stack hardening
  in 0.3.x stopped silently truncating one of the upstream responses).
- The `benchmarks/runners/run_biocli.sh` data-02 task now uses
  `--skip-download` instead of the removed `--plan` flag in
  `aggregate workflow-prepare`. The runner had been silently failing
  this task since the flag was removed earlier in 0.3.x.

### Notes
- 0.4.0 contains no runtime behavior changes versus 0.3.9 beyond the
  ncbicli stderr deprecation notice. Users on 0.3.9 can upgrade with no
  migration.
- Windows limitation: when invoked through the npm-installed
  `ncbicli.cmd` shim, `process.argv[1]` is the resolved `.js` path (the
  shim re-spawns node with that path), so the deprecation warning may
  not fire on Windows. Tracked for follow-up.

## [0.3.9] - 2026-04-04

Network-stack hardening release. Highlights from the 0.3.5 → 0.3.9 line:

- `7ac75a9` install undici Happy Eyeballs dispatcher (fixes WSL2 IPv6 hangs)
- `f8c69da` dispatcher install via side-effect import
- `276b31c` explicit IPv4 fallback for `doctor` and NCBI fetch
- `07a7fc6` race-pattern IPv4 fallback
- `04b4348` `ipv4Agent` forces IPv4 via custom DNS lookup
- `1f6baa5` race cleanup only aborts loser, not winner's body stream
- `3da1aab` lower `defaultAgent` connect timeout to 5s
- `2c8992e` ClinVar `germline_classification` field rename

## Earlier

For history before 0.3.9, see `git log v0.2.0..v0.3.9`.
