# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.4.0] - 2026-04-08

The first public-facing release. Three things ship together:

1. **Release-engineering baseline** — repository metadata, deprecation path
   for the legacy `ncbicli` binary, refreshed benchmark labelled against the
   actually-published code, first curated GitHub Release.
2. **Reference Dataset pattern + Unimod** — biocli's first local-snapshot
   data source, the canonical mass-spec PTM dictionary.
3. **Proteomics backends + cross-omics aggregation** — ProteomeXchange and
   PRIDE as full HTTP backends, plus `aggregate ptm-datasets` fusing Unimod
   with the PROXI dataset index.

### Added — Release engineering

- `package.json` now declares `author`, `repository`, `homepage`, and
  `bugs` so the npm and GitHub package pages render with the right links.
- Stderr deprecation notice when biocli is invoked via the legacy
  `ncbicli` binary. Set `BIOCLI_NO_DEPRECATION=1` to silence. Suppressed
  during shell completion (`--get-completions`) so completion candidates
  stay parseable.
- `CHANGELOG.md` (this file).
- First curated GitHub Release.

### Added — Unimod (first Reference Dataset)

biocli's first **Reference Dataset**: Unimod, the mass-spec community's
canonical post-translational modification dictionary (~1560 entries),
distributed as an XML dump and queried in memory.

- Seven new CLI commands: `unimod install`, `unimod refresh`,
  `unimod fetch`, `unimod search`, `unimod list`, `unimod by-mass`,
  `unimod by-residue`.
- `unimod by-mass` is the killer command for open-search PTM annotation:
  takes a mass shift (Da or ppm tolerance, positive OR negative delta)
  and returns ranked Unimod candidates with delta-from-query.
- New `src/datasets/` directory parallel to `src/databases/` hosting the
  Reference Dataset loader pattern. Future snapshot sources (PSI-MOD, GO,
  ChEBI) reuse the same infrastructure with no core changes.
- New `noContext: true` flag on `CliCommand` exempts a command from the
  HttpContext factory and the response cache. Generalizes the previous
  hardcoded `database === 'aggregate'` exemption. Propagates through the
  manifest build → load round-trip, including for lazy-loaded TS adapters.
- Atomic write semantics (tmp file + rename), SHA-256 integrity, post-
  download sanity checks (XML prologue + min body size + min mod count).
- Singleton load with catch-reset so transient failures don't pin a
  rejected promise for the process lifetime.
- `BIOCLI_DATASETS_DIR` environment variable override for test isolation.
- `biocli doctor` reports Unimod cache status (mod count + age, with a
  yellow "stale" warning past 90 days).

### Added — ProteomeXchange + PRIDE (proteomics data repositories)

Two new HTTP backends and four new commands give biocli first-class
access to the ProteomeXchange consortium.

- New `proteomexchange` backend (PROXI v0.1 hub at ProteomeCentral,
  2 req/s) federates PRIDE / iProX / MassIVE / jPOST under one search
  interface.
- New `pride` backend (EBI PRIDE Archive REST v3, 5 req/s) provides rich
  per-project metadata as a "detail upgrade" for PRIDE-hosted datasets.
- Both backends implement exponential 5xx retry (1s, 2s, max 3 attempts,
  retries only on 500/502/503/504) — defense against ProteomeCentral's
  known transient outages.
- New CLI commands:
  - `biocli px search <query>` — federated dataset search with filters
    for modification, instrument, repository, year.
  - `biocli px dataset <PXD>` — full metadata, hub-first with automatic
    PRIDE detail upgrade and graceful degraded-mode fallback when PRIDE
    is unavailable.
  - `biocli px files <PXD>` — file listing with FTP/Aspera URLs
    (PRIDE-only in v1; non-PRIDE accessions exit 69 with a hint).
  - `biocli aggregate ptm-datasets <gene> --modification <type>` — fuses
    Unimod modification names with the PROXI dataset index to answer
    "find datasets reporting this PTM on this gene".

### Added — Output layer

- `RenderOptions.warnings?: string[]` field with new `emitWarnings()`
  helper prints yellow warning lines on stderr after every format.
  Closes a pre-existing gap where `BiocliResult.warnings` was silently
  dropped in table/plain output and only visible in JSON/YAML.
- `commander-adapter.ts` extracts `BiocliResult.warnings` and plumbs
  them into the renderer in all formats.
- Regression test in `src/output.test.ts` locks the invariant: warnings
  are emitted exactly once per render call regardless of format.

### Changed

- All documentation references to the planning placeholder `@biocli/cli`
  are now `@yangfei_93sky/biocli` — affects RELEASE_CHECKLIST.md,
  PLUGIN_DEV.md, the registry-api JSDoc, ADR-001, and the benchmark
  install line in `tasks.yaml`.
- Benchmark refreshed against `biocli 0.3.9 / biomcp 0.8.19 / gget 0.30.3`
  on 2026-04-08. Scored capabilities unchanged versus the 2026-04-04
  baseline; this is a re-run for honest version labeling, not a
  re-evaluation. biocli scored 97/100 (was 96 against 0.2.0; +1 from
  gene-02 now hitting all four criteria after the 0.3.x network-stack
  hardening stopped silently truncating one of the upstream responses).
- The `benchmarks/runners/run_biocli.sh` data-02 task now uses
  `--skip-download` instead of the removed `--plan` flag in
  `aggregate workflow-prepare`. The runner had been silently failing
  this task since the flag was removed earlier in the 0.3.x line.

### Fixed

- The unimod module shipped with 7 review-caught bugs fixed before
  merge: negative mass support in `by-mass`, half-installed state
  detection in `doctor` and `refreshUnimod`, case-insensitive
  N-term/C-term handling in residue filters, ANSI escape codes leaking
  into doctor JSON output, `fetch` vs `install` command semantics,
  hardcoded `'unimod'` check in execution.ts replaced with the
  generalized `noContext` flag, and manifest round-trip serialization
  of the flag for lazy-loaded TS adapters.
- Pre-existing bug: `BiocliResult.warnings` was silently dropped in
  `table` and `plain` output formats, visible only in JSON/YAML.

### Notes

- 0.4.0 contains no behavior changes to existing commands beyond (a) the
  ncbicli stderr deprecation notice, and (b) warnings now visible in
  table/plain output instead of being silently dropped. Users on 0.3.9
  can upgrade with no migration.
- **Windows limitation**: when invoked through the npm-installed
  `ncbicli.cmd` shim, `process.argv[1]` is the resolved `.js` path (the
  shim re-spawns node with that path), so the deprecation warning may
  not fire on Windows. Tracked for follow-up.
- New optional `noContext?: boolean` on `CliCommand` and
  `warnings?: string[]` on `RenderOptions` are backward-compatible;
  existing commands and renderers keep working with no changes.

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
