# Architecture

This document describes the `v0.8.0` runtime.

## Runtime map

```text
biocli CLI                         optional biocli-mcp companion
    │                                         │
    └──────────────┬──────────────────────────┘
                   ▼
            initializeBiocli()
       dispatcher · backends · discovery · hooks
                   │
                   ▼
             command registry
      prebuilt manifest or filesystem fallback
                   │
          ┌────────┴────────┐
          ▼                 ▼
  Commander adapter      MCP tools
          └────────┬────────┘
                   ▼
            executeCommand()
 validation · env · cache · timeout · lifecycle hooks
                   │
          ┌────────┴──────────┐
          ▼                   ▼
 TypeScript command       YAML pipeline
          │                   │
          └────────┬──────────┘
                   ▼
     HTTP backends / local reference datasets
                   │
                   ▼
  rows · ResultWithMeta · BiocliResult · batch artifacts
```

## Bootstrap and discovery

[`src/main.ts`](src/main.ts) is the CLI entrypoint. It prints the legacy-name deprecation notice, calls `initializeBiocli()`, and hands control to Commander.

[`src/bootstrap.ts`](src/bootstrap.ts) is shared by CLI and MCP consumers. It:

1. installs the Undici dispatcher before other runtime modules;
2. registers all built-in database backends;
3. discovers built-in commands and optional user plugins;
4. emits the startup lifecycle hook once per process.

[`src/discovery.ts`](src/discovery.ts) has two paths:

- Production fast path: load `dist/cli-manifest.json`. YAML pipelines are already embedded and TypeScript command modules are lazy-loaded on first use.
- Development fallback: scan `src/clis/`, parse YAML, and import TypeScript modules from the filesystem.

User extensions live under `~/.biocli/clis/` and `~/.biocli/plugins/`.

## Command model

[`src/registry.ts`](src/registry.ts) owns the global command registry and `CliCommand` contract. Command metadata includes:

- arguments, defaults, types, and output columns;
- database and execution strategy;
- timeout and required environment variables;
- agent examples and routing hints;
- `readOnly`, side effects, and expected artifacts;
- `noContext` for aggregate or local-dataset commands that manage their own data access.

Simple single-source commands can be YAML pipelines. Multi-request, aggregate, local-dataset, or file-writing commands are TypeScript modules. Most current commands are TypeScript; YAML remains a supported adapter format rather than the dominant implementation path.

## Execution boundary

[`src/execution.ts`](src/execution.ts) is the single command execution boundary for CLI and MCP. It:

1. lazy-loads a TypeScript module when required;
2. coerces and validates arguments;
3. validates required environment variables;
4. creates a database-specific `HttpContext` unless `noContext` is set;
5. applies the result cache and command timeout;
6. executes a TypeScript function or YAML pipeline;
7. emits before/after lifecycle hooks.

Aggregate workflows create multiple database contexts explicitly and decide how partial upstream failures affect warnings and completeness.

## Data access

[`src/databases/index.ts`](src/databases/index.ts) contains the backend registry and factory. Bootstrap currently registers 11 backends:

- NCBI
- UniProt
- KEGG
- STRING
- Ensembl
- Enrichr
- ProteomeXchange
- PRIDE
- cBioPortal
- Open Targets
- GDSC

NCBI sub-sites such as PubMed, Gene, GEO, SRA, ClinVar, dbSNP, and Taxonomy share the NCBI backend.

Each backend creates an `HttpContext` with `fetch`, `fetchJson`, `fetchXml`, and `fetchText`. Backend clients use the shared retry policy and rate limiter while retaining backend-specific retry/rate settings. The Undici dispatcher implements dual-stack connection handling and explicit IPv4 fallback.

Local reference datasets are implemented under [`src/datasets/`](src/datasets/):

- Unimod: local XML snapshot with integrity and freshness metadata.
- GDSC: downloaded release files plus a derived sensitivity index. GDSC also has a registered backend for download/refresh operations.

Regenerable downloads and indexes belong in the user's dataset/cache directory, not in command source or result contracts.

## Result contracts

Atomic commands return raw rows or `ResultWithMeta` when pagination context is needed. Aggregate workflows return `BiocliResult<T>` with:

```ts
interface BiocliResult<T> {
  biocliVersion: string;
  data: T;
  ids: Record<string, string>;
  sources: string[];
  warnings: string[];
  queriedAt: string;
  organism?: string;
  query: string;
  completeness: 'complete' | 'partial' | 'degraded';
  provenance: BiocliProvenance;
}
```

The summary-first hero workflows (`gene-profile`, `drug-target`, and `tumor-gene-dossier`) additionally expose `data.agentSummary`. The stable consumer rules are documented in [`docs/contracts/hero-summary.md`](docs/contracts/hero-summary.md).

The `drug-target` candidate ranking is explicitly versioned and auditable; see [`docs/methods/drug-target-ranking.md`](docs/methods/drug-target-ranking.md).

## Batch execution

[`src/batch-execution.ts`](src/batch-execution.ts) is the common batch execution core used by:

- generic non-aggregate commands through [`src/commander-adapter.ts`](src/commander-adapter.ts);
- hero aggregate commands through [`src/clis/aggregate/batch-runtime.ts`](src/clis/aggregate/batch-runtime.ts).

The shared core owns indexing, bounded concurrency, retry limits, cache reads/writes, resume checkpoint selection, success/failure records, snapshot metadata, and artifact finalization. Wrappers retain command-specific preparation, cache-read policy, progress wording, and all-failed behavior.

A run directory uses the stable artifact contract:

```text
results.jsonl
failures.jsonl
summary.json
summary.csv       # when a command flattener is available
manifest.json
methods.md
```

See [`docs/contracts/run-artifacts.md`](docs/contracts/run-artifacts.md) for schemas and recovery semantics.

## MCP companion

[`packages/biocli-mcp/`](packages/biocli-mcp/) is an optional companion that loads the built core package and exposes either a small hero scope or the full command registry. It uses the same bootstrap, registry, execution, result normalization, and command metadata as the CLI.

MCP read-only annotations derive from `CliCommand.readOnly`; file-writing commands must set `readOnly: false` at command registration rather than being maintained in a second list.

## Build and verification

`npm run build` performs a clean TypeScript build, copies YAML adapters, generates `dist/cli-manifest.json`, and removes AppleDouble files from build output.

Vitest is split into four projects:

- `unit`: core logic without adapter modules;
- `adapter`: command and backend tests, normally with mocked `HttpContext`/upstream responses;
- `e2e`: end-to-end tests;
- `smoke`: packaged command smoke tests.

CI runs Node 20 and Node 22, then checks repository hygiene, executes typecheck and all Vitest projects, builds the package, and runs core smoke tests. Live upstream checks are separate because network and service availability are external variables.

## Key files

| File | Responsibility |
|---|---|
| `src/main.ts` | CLI entrypoint |
| `src/bootstrap.ts` | Shared runtime initialization |
| `src/discovery.ts` | Manifest/filesystem command discovery |
| `src/registry.ts` | Command and metadata registry |
| `src/commander-adapter.ts` | Commander argument collection and rendering |
| `src/mcp-core.ts` | MCP command selection, descriptions, annotations, result normalization |
| `src/execution.ts` | Validation, context, cache, timeout, hooks, execution |
| `src/batch-execution.ts` | Shared batch runtime |
| `src/batch-resume.ts` | Checkpoints and artifact-session merge |
| `src/databases/index.ts` | HTTP backend registry/factory |
| `src/datasets/` | Local reference dataset loaders |
| `src/types.ts` | HTTP and result contracts |
| `src/output.ts` | Interactive/stdout formats |
| `src/doctor.ts` | Runtime, network, and dataset diagnostics |
