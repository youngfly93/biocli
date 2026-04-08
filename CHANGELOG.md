# Changelog

All notable changes to biocli are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.4.0] — 2026-04-08

### Added — Unimod (local PTM dictionary)

biocli's first **Reference Dataset**: Unimod, the mass-spec community's
canonical post-translational modification dictionary (~1560 entries),
distributed as an XML dump and queried in memory.

- New CLI commands: `unimod install`, `unimod refresh`, `unimod fetch`,
  `unimod search`, `unimod list`, `unimod by-mass`, `unimod by-residue`
- `unimod by-mass` is the killer command for open-search PTM annotation:
  takes a mass shift (Da or ppm tolerance, positive OR negative) and
  returns ranked Unimod candidates with delta-from-query
- New `src/datasets/` directory hosting the Reference Dataset loader
  pattern. Future snapshot sources (PSI-MOD, GO, ChEBI) reuse the same
  infrastructure
- New `noContext: true` flag on `CliCommand` exempts a command from the
  HttpContext factory and the response cache. Generalizes the previous
  hardcoded `database === 'aggregate'` exemption
- Atomic write semantics (tmp file + rename), SHA-256 integrity, post-download
  sanity checks (XML prologue + min body size + min mod count)
- Singleton load with catch-reset so transient failures don't pin a
  rejected promise for the process lifetime
- `BIOCLI_DATASETS_DIR` env var override for test isolation
- `biocli doctor` reports Unimod cache status (mod count + age, with
  yellow stale warning past 90 days)
- Fully integrated into manifest serialization so `noContext` survives
  the build → load round-trip

### Added — ProteomeXchange + PRIDE (proteomics data repositories)

Two new HTTP backends and four new commands give biocli first-class
access to the ProteomeXchange consortium.

- New `proteomexchange` backend (PROXI v0.1 hub at ProteomeCentral, 2 req/s)
  federates PRIDE / iProX / MassIVE / jPOST under one search interface
- New `pride` backend (EBI PRIDE Archive REST v3, 5 req/s) provides rich
  per-project metadata as a "detail upgrade" for PRIDE-hosted datasets
- Both backends implement exponential 5xx retry (1s, 2s, max 3 attempts
  on 500/502/503/504 only) — defense against ProteomeCentral's known
  transient outages
- New CLI commands:
  - `biocli px search <query>` — federated dataset search with filters
    for modification, instrument, repository, year
  - `biocli px dataset <PXD>` — full metadata, hub-first with automatic
    PRIDE detail upgrade and graceful degraded-mode fallback
  - `biocli px files <PXD>` — file listing with FTP/Aspera URLs
    (PRIDE-only in v1; non-PRIDE accessions exit 69 with a hint)
  - `biocli aggregate ptm-datasets <gene> --modification <type>` —
    fuses Unimod modification names with the PROXI dataset index to
    answer "find datasets reporting this PTM on this gene"

### Added — output layer

- `RenderOptions.warnings?: string[]` field with `emitWarnings()` helper
  prints yellow warning lines on stderr after every format. Closes a
  pre-existing gap where `BiocliResult.warnings` was silently dropped in
  table/plain output and only visible in JSON/YAML
- `commander-adapter.ts` extracts `BiocliResult.warnings` and plumbs them
  into the renderer in all formats
- Regression test in `src/output.test.ts` locks the invariant: warnings
  must be emitted exactly once per render call regardless of format

### Fixed

- The unimod work shipped with 7 review-found bugs that were caught and
  fixed before release: negative mass support in `by-mass`, half-installed
  state detection in doctor + refreshUnimod, case-insensitive N-term/C-term
  in residue filters, ANSI escape codes leaking into doctor JSON output,
  `fetch` vs `install` command semantics, hardcoded `'unimod'` in
  execution.ts replaced with the generalized `noContext` flag, and
  manifest round-trip serialization of that flag

### Internal

- New `src/datasets/` directory parallel to `src/databases/`
- New `src/clis/_shared/proteomics.ts` (PXD validator + repository classifier)
- New `src/clis/_shared/px-upgrade.ts` (pure hub→PRIDE upgrade helper)
- 100+ new tests across unit and adapter test projects
- Clean offline build with the new manifest entries

### Compatibility

- No breaking changes. All existing commands work identically.
- New optional `noContext?: boolean` field on `CliCommand` is
  backward-compatible (existing commands ignore it).
- New optional `warnings?: string[]` field on `RenderOptions` is
  backward-compatible (existing commands pass undefined).

## [0.3.9] — 2026-04-04

- Bump README header to v0.3.9.

## [0.3.8] and earlier

See git history for prior releases. Notable themes:
- IPv4 fallback dispatcher to fix WSL2 / dual-stack IPv6 hangs (#1)
- ClinVar `germline_classification` field rename
- Aggregate workflow commands (gene-dossier, workflow-scout, workflow-prepare)
