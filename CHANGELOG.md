# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.8.1] - 2026-08-26

Closes four gaps found by an independent review of `0.8.0`, in each case where
the shipped behaviour did not fully match what the docs and commit messages
claimed. `0.8.0` was never published to npm; this is the first npm release of
the 0.8 line.

### Fixed

- **A 429 retry now consumes a rate-limit slot.** `0.8.0` made a 429 back off
  the whole backend, but the retry itself still fired without acquiring a slot,
  so two requests could land inside a one-request window. Measured at 1 req/s,
  a 429 exchange went out at `0ms` and `108ms`; it now goes out at `0ms` and
  `2006ms` with a competing worker served at `1003ms`. Backends pass
  `rateLimited` through so callers using `skipRateLimit` keep unmetered retries.
- **`RateLimiter.penalize()` no longer clears the rate window.** Clearing it
  handed budget back and let a burst through the moment the cooldown expired.
  The cooldown adds delay; the window enforces the rate.
- **`--strict` now fails on hard failures too.** It only checked items that
  succeeded with incomplete data, so a run with terminal failures passed the
  coverage gate it was written to enforce.
- **A failed `--retry-degraded` attempt stays auditable.** The new failure
  record was filtered out by the retained earlier success, leaving
  `failures.jsonl` empty with no way to see why the recovery did not help. It is
  now kept. `failures.jsonl` is the audit log of attempts that failed;
  `summary.json` `failed` counts items left with no usable result, so the two
  can differ when a partial result is retained.
- **`-f plain`, table, and card no longer render nested fields as
  `[object Object]`.** `0.8.0` wired the shared cell formatter into CSV and
  Markdown only. Table column widths are measured with the same formatter, so
  nested fields no longer size their column against `[object Object]`.

### Changed

- `RELEASE_CHECKLIST.md` requires remote CI to pass before a GitHub Release is
  created. The `0.8.0` release was created about 12 seconds before CI finished.
- `plan.md` records current state; the `0.7.1` baseline is kept as history.

## [0.8.0] - 2026-08-26

This release is about trust in batch output. The per-item `completeness` field
was always correct, but the summary, recovery, and reporting layers ignored it,
so an incomplete run could present itself as fully successful.

### Behavior Changes

These are bug fixes, but they change observable output. Check any script or
agent that relies on the old behavior.

- `-f table` is now honored when passed explicitly. Previously a command's
  `defaultFormat` replaced it, so `aggregate <cmd> -f table` emitted JSON. If a
  script passed `-f table` and parsed JSON, switch it to `-f json`.
- An unknown `-f` value now exits `2` instead of silently rendering a table
  with exit `0`.
- `-f csv` and `-f md` now render nested fields as `; `-joined labels instead of
  `[object Object]`.
- `summary.json` and `manifest.json` gain `degraded` and `completeness` for
  commands that report completeness. Existing fields are unchanged.

### Added

- **Batch coverage is now visible and recoverable** — a batch item could
  previously succeed while returning incomplete data (an upstream 429, a skipped
  cross-reference, an unresolvable symbol), and nothing at the top level said so:
  `summary.json` reported `succeeded: N, failed: 0`, `failures.jsonl` stayed
  empty, and `--resume` skipped the degraded row forever.
  - `summary.json` and `manifest.json` gain `degraded` and a
    `completeness: { complete, partial, degraded }` breakdown, emitted only when
    the command reports completeness so other summaries keep their shape
  - a run-end stderr warning names the affected inputs
  - `--retry-degraded` resumes and reruns only the incomplete items, bypassing
    cache reads so a retry is never answered by the entry that produced it
  - `--strict` exits `65` (`EX_DATAERR`) when coverage is incomplete
- Versioned `aggregate drug-target` ranking method
  (`biocli-drug-target-ranking-v1`) with auditable score components and a
  methods document covering weights, evidence selection, and limitations
- Canonical `agent-ab-v1` operational scoring contract, scoring manifests,
  evidence-review templates, and hash-pinned handling for known historical
  raw-result failures
- Repository-hygiene validation for benchmark runtime homes, oversized result
  artifacts, and machine-local documentation links

### Changed

- Generic CLI batch commands and aggregate hero workflows now share one batch
  execution core for caching, retries, resume checkpoints, failure records, and
  run-artifact finalization
- Undici moved to the Node-20-compatible 6.x line so the installed dependency matches
  biocli's declared Node.js >=20 compatibility and CI matrix
- js-yaml's minimum version moved to the patched 4.3.1 release
- Pipeline benchmark runtime homes now live under ignored `.work/` storage;
  retained dataset evidence is described by checksummed snapshot metadata

### Fixed

- MCP `readOnlyHint` now follows each command's `readOnly` metadata instead of a
  separate hard-coded list that omitted some file-writing commands
- `aggregate drug-target --report-limit` now controls presentation only; all
  unique reports returned by Open Targets are used consistently for ranking and
  source counts
- `manifest.json` `resume.skippedCompleted` now reports what the rerun actually
  skipped instead of the size of the previous success list
- **`-f csv` and `-f md` no longer destroy nested fields.** Nested values were
  stringified directly, so a gene's 51 pathways became `[object Object]`
  repeated 51 times — on the path most people use to load results into R or a
  spreadsheet. Nested records now reduce to their most identifying label,
  joined with `; `
- **An explicit `-f table` is no longer overridden.** Commander's default for
  `-f` is `table`, so an explicit `-f table` was indistinguishable from an
  unspecified format and a command's `defaultFormat` silently replaced it —
  `aggregate gene-profile EGFR -f table` printed 777 lines of JSON. Explicit
  formats now win over both `defaultFormat` and the non-TTY JSON heuristic
- An unknown `-f` value now fails with exit `2` and lists the supported formats
  instead of falling through to the table renderer with exit `0`
- `ARCHITECTURE.md` documented `completeness` as `'complete' | 'partial' |
  'empty'`; the actual union is `'complete' | 'partial' | 'degraded'`, as
  `docs/contracts/hero-summary.md` already stated
- **Batch `methods.md` no longer fabricates provenance.** Sources were deduped
  by backend name across the whole run, so the first item to contribute a
  backend lent its accession numbers to every other item — a 12-gene run could
  state EGFR's UniProt record and KRAS's NCBI/KEGG records as one provenance
  sentence. Record identifiers are no longer carried to batch level (they stay
  per-item in `results.jsonl`), and a URL survives only when it is a backend
  root rather than a record landing page
- **Upstream rate limiting now backs off the whole client, not one request.**
  Backends acquire a rate-limit slot *before* the retry loop, so an HTTP 429
  only slowed the rejected request while every other in-flight worker kept
  saturating the same window — and the retry itself bypassed the limiter
  entirely, adding load exactly when the upstream asked for less. A 429 now
  applies a cooldown to that backend's limiter and clears its window, so all
  workers pause together. This is what let a default-concurrency gene-profile
  batch lose a gene's KEGG pathways to a transient NCBI 429
- Batch `methods.md` completeness was derived from hard failures alone, so a run
  of partial results described itself as `complete`. It now reflects per-item
  completeness, and the block lists complete/incomplete counts and names the
  incomplete inputs

## [0.7.1] - 2026-04-14

### Fixed

- Unified hero-workflow `agentSummary.completeness` with the top-level
  `BiocliResult.completeness` derivation

## [0.7.0] - 2026-04-14

### Added

- Stable, summary-first `data.agentSummary` contracts for `gene-profile`,
  `drug-target`, and `tumor-gene-dossier`
- Task-first documentation for batch gene scanning, tumor cohort briefing, and
  target discovery, including run-artifact and hero-summary contracts
- Cache-aware hero batch examples and MCP descriptions that route agents to
  `agentSummary` before full-report drill-down

## [0.6.0] - 2026-04-14

### Added

- **Batch pipeline infrastructure** — unified batch runner with bounded concurrency,
  structured failure model, output directory contract (results.jsonl, failures.jsonl,
  summary.json, summary.csv, manifest.json, methods.md), resume & checkpointing,
  and cache-aware execution (skip-cached / force-refresh)
- **Unified HTTP retry policy** — `retry-policy.ts` with per-backend strategy overrides;
  all 7 HTTP backends (NCBI, UniProt, KEGG, STRING, Enrichr, Open Targets, cBioPortal)
  refactored to use `executeHttpRequestWithRetry()`
- **Hero command batch adoption** — `gene-profile`, `drug-target`, and `tumor-gene-dossier`
  support batch input via `--input-file`, `--concurrency`, `--resume`, `--outdir`
- **Co-mutations context annotation** — TMB indicator genes (TTN, MUC16, etc.) distinguished
  from known cancer drivers (KRAS, KEAP1, etc.) via `context.tag` field
- **Drug-target clinical enrichment** — Open Targets GraphQL now returns `description` and
  `approvedIndications` for each candidate drug
- **Agent A/B benchmark** — 8-task evaluation framework comparing biocli-assisted vs
  web-only agent performance (`benchmarks/agent-ab/`)
- **Pipeline benchmark** — batch execution harness for throughput, resume, and cache testing
  (`benchmarks/pipeline/`)
- **Test coverage expansion** — 91 test files, 466 tests; new coverage for cli.ts,
  pipeline engine, validate, verify, workflow-annotate, workflow-profile, completion

### Changed

- Co-mutations uses batched gene-level queries (CANCER_DRIVER_GENE_IDS) instead of
  full-cohort scan — **25x speedup** on TCGA LUAD cohorts

## [0.5.0] - 2026-04-12

### Added

- **cBioPortal backend** — 5 commands: studies, profiles, mutations, frequency, co-mutations
- **Open Targets backend** — target search, tractability, disease evidence, drug candidates (GraphQL)
- **GDSC backend** — drug sensitivity index (local reference dataset)
- **New aggregate commands** — drug-target, tumor-gene-dossier, compare-genes
- **Catalog metadata layer** — per-command JSON Schema, agent-facing examples (17 commands),
  workflow catalog (6 pipelines), readOnly/sideEffects/artifacts on all 65 commands,
  producedBy cross-command links, whenToUse routing hints
- **Progress reporting** — AsyncLocalStorage-based progress for slow aggregate commands
- **MCP companion package** — split into `@yangfei_93sky/biocli-mcp`
- **Methods command** — generate publication-ready summaries from result JSON
- **Provenance schema** — BiocliResult enhanced with completeness, provenance, biocliVersion
- **Conda packaging scaffold**

### Fixed

- Manifest modulePath attribution (import side-effect bug)
- defaultFormat / requiredEnv not serialized in manifest
- Batch mode incorrectly splitting comma-separated gene lists (enrichr, string commands)
- Ensembl lookup/xrefs now accept Ensembl IDs (ENSG*)
- Error hints changed from NCBI-hardcoded to agent-actionable per-backend guidance
- AppleDouble cleanup in build pipeline
- validate skips hidden files

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
- The `benchmarks/runners/run_biocli.sh` data-02 task now uses
  `--skip-download` instead of the removed `--plan` flag in
  `aggregate workflow-prepare`. The runner had been silently failing
  this task since the flag was removed earlier in the 0.3.x line.

### Changed — Benchmark methodology (v1 → v2)

The README and the public benchmark surface now ship a new fair-benchmark
v2 methodology. The previous v1 single-weighted-total layout (biocli
97/100 vs BioMCP 44 vs gget 24) is preserved historically under
`benchmarks/results/2026-04-08/` but is no longer the headline.

What's different in v2:

- **No combined "winner" total.** Coverage and quality are reported
  separately. Core retrieval and workflow tracks are reported separately.
- **Unsupported tasks are not zeros.** A task a tool does not natively
  support moves to the coverage column and is excluded from quality
  scoring entirely. The previous v1 layout structurally penalized any
  tool with narrower scope than biocli.
- **Four tools, not three.** EDirect 25.3 was added as the canonical
  NCBI retrieval baseline. EDirect's 97.4 core quality edges biocli's
  96.7 on the supported overlap — biocli's lead now correctly shows in
  *coverage* (73% vs 65%) and especially in the workflow track (88% vs
  10%).
- **n=3 cold runs per cell** with median reporting; p50 latency is
  descriptive, not a quality dimension.
- **Per-task evidence is preserved.** Each scored cell carries
  `{stdout, stderr, result, normalized, score}` files with explicit
  passed/failed checks plus an `evidence` field, so any reviewer can
  audit why a particular dimension scored as it did.
- **Failures are visible.** BioMCP's 3/3 failure on `core-enrichment`
  (g:Profiler upstream unavailable) is recorded in the manifest, not
  silently dropped.
- **`benchmarks/v2/`** ships the public-lite bundle with rubric, frozen
  capability matrix, headline plots, scorecards, and run manifests. The
  full per-task audit (≈160 MB across 105 cells × `r01..r03`) is
  attached as a downloadable bundle on each GitHub Release rather than
  committed into git.

Headline v2 results (biocli 0.3.9):

| Track | Coverage | Quality | p50 latency |
|---|---:|---:|---:|
| Core | 73% | 96.7 | 128 ms |
| Workflow | 88% | 100.0 | 134 ms |

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
