# Architecture

## System Overview

```
bin/biocli (CLI entry)
  │
  ├─ Discovery (discovery.ts)
  │    Finds YAML/TS adapters in src/clis/ + plugins in ~/.biocli/plugins/
  │    Fast path: pre-built manifest (build-manifest.ts)
  │    Fallback: filesystem scan + YAML parse
  │
  ├─ Commander Adapter (commander-adapter.ts)
  │    Bridges command registry → Commander.js subcommands
  │    Handles arg parsing, format selection, output rendering
  │
  ├─ Execution (execution.ts)
  │    Validates/coerces args → creates HttpContext → runs command
  │    Supports timeout enforcement and lifecycle hooks
  │
  ├─ Database Backends (databases/*.ts)
  │    Per-database HTTP clients with rate limiting and retry
  │    NCBI | UniProt | KEGG | STRING | Ensembl | Enrichr
  │
  ├─ Pipeline Engine (pipeline/*.ts)
  │    Executes YAML adapter pipelines (fetch → map → filter → sort)
  │
  └─ Output (output.ts)
       Formats results as table, JSON, CSV, YAML, Markdown, or card view
```

## Database Backend Pattern

Each backend in `src/databases/` implements the `DatabaseBackend` interface:

```ts
interface DatabaseBackend {
  readonly id: string;        // e.g. 'ncbi', 'uniprot'
  readonly name: string;      // e.g. 'NCBI', 'UniProt'
  readonly baseUrl: string;   // API base URL
  readonly rateLimit: number; // max requests per second
  createContext(): HttpContext;
}
```

**To add a new database backend:**

1. Create `src/databases/<name>.ts`
2. Export `buildXxxUrl()` (pure URL builder, easily testable)
3. Export the `DatabaseBackend` object and call `registerBackend()` at module level
4. Add a side-effect import in `src/main.ts`

## Command Registration

Two modes for defining commands:

### YAML Adapters (declarative)

For simple single-fetch commands. Place in `src/clis/<db>/<command>.yaml`:

```yaml
site: pubmed
name: info
database: pubmed
strategy: public
pipeline:
  - fetch: { url: '...', params: { ... } }
  - select: einforesult.dbinfo
  - map: { field: '${{ item.value }}' }
columns: [field1, field2]
```

### TypeScript Adapters (programmatic)

For multi-step or complex logic. Place in `src/clis/<db>/<command>.ts`:

```ts
import { cli, Strategy } from '../../registry.js';

cli({
  site: 'gene',
  name: 'search',
  database: 'gene',
  strategy: Strategy.PUBLIC,
  args: [{ name: 'query', positional: true, required: true }],
  columns: ['geneId', 'symbol', 'name'],
  func: async (ctx, args) => {
    const data = await ctx.fetchJson(url);
    return [{ geneId: '...', symbol: '...', name: '...' }];
  },
});
```

## HttpContext (Dependency Injection)

Commands receive an `HttpContext` with database-aware fetch methods:

```ts
interface HttpContext {
  databaseId: string;
  fetch(url: string, opts?: FetchOptions): Promise<Response>;
  fetchJson(url: string, opts?: FetchOptions): Promise<unknown>;
  fetchXml(url: string, opts?: FetchOptions): Promise<unknown>;
  fetchText(url: string, opts?: FetchOptions): Promise<string>;
}
```

This is the DI mechanism that makes commands testable — tests mock `HttpContext` without touching the network.

## Agent-First Result Envelope

Aggregation commands return `BiocliResult<T>`:

```ts
interface BiocliResult<T> {
  data: T;                       // Primary payload
  ids: Record<string, string>;   // Cross-database identifiers
  sources: string[];             // Which backends contributed
  warnings: string[];            // Non-fatal issues
  queriedAt: string;             // ISO timestamp
  organism?: string;             // Scientific name
  query: string;                 // Original query
}
```

Atomic commands use `ResultWithMeta` for pagination context (`totalCount`, `query`).

## Rate Limiting

Per-database `RateLimiter` instances stored in `globalThis`:
- Sliding window algorithm
- NCBI: 3 req/s (anonymous), 10 req/s (with API key)
- UniProt: 50 req/s, KEGG: 10 req/s, STRING: 1 req/s, Ensembl: 15 req/s, Enrichr: 5 req/s
- All backends implement exponential backoff retry on HTTP 429

## Manifest Fast Path

`npm run build` generates `dist/manifest.json` via `build-manifest.ts`:
- Pre-parses YAML adapter definitions at build time
- At runtime, `discovery.ts` loads the manifest for instant startup
- Falls back to filesystem scan in development (`npm run dev`)

## Key Files

| File | Purpose |
|------|---------|
| `src/main.ts` | Entry point, backend registration, discovery |
| `src/cli.ts` | Built-in commands (list, validate, config, schema, doctor, completion) |
| `src/registry.ts` | Command registry (CliCommand interface, global Map) |
| `src/commander-adapter.ts` | Commander.js bridge, output rendering |
| `src/execution.ts` | Arg validation, context creation, command execution |
| `src/databases/index.ts` | Backend interface, registry, factory |
| `src/types.ts` | HttpContext, BiocliResult, ResultWithMeta |
| `src/output.ts` | Multi-format output rendering |
| `src/doctor.ts` | Diagnostic checks |
| `src/schema.ts` | JSON Schema definitions |
