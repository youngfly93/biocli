# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build & Test Commands

```bash
npm run build            # Full build: clean + tsc + copy YAML + build manifest
npm run typecheck        # Type check only (tsc --noEmit)
npm test                 # Unit tests (non-adapter)
npm run test:adapter     # Command/backend tests with mocked upstream contexts
npm run test:all         # All test projects
npm run smoke:core       # Offline packaged-command smoke tests
npm run smoke:live       # Opt-in live upstream checks
```

## Code Style

- **TypeScript strict mode** — avoid `any` where possible
- **ES Modules** — always use `.js` extensions in imports
- **Naming**: `kebab-case` for files, `camelCase` for variables/functions, `PascalCase` for types/classes
- **No default exports** — use named exports only

## Adapter Conventions

- **YAML adapters** for simple API queries: `src/clis/<db>/<command>.yaml`
- **TypeScript adapters** for multi-step queries: `src/clis/<db>/<command>.ts`
- **Positional args** for the primary target (query, ID); **named options** for configuration (limit, sort, format)
- Import from registry: `import { cli, Strategy } from '../../registry.js';`
- Use `ctx.fetchJson()` for JSON endpoints, `ctx.fetchXml()` for XML
- NCBI adapters use the shared E-utilities helpers; other sites use their registered backend client
- Commands that write files or dataset state must set `readOnly: false` and declare `sideEffects` / `artifacts`

## Architecture

- `src/bootstrap.ts` — shared CLI/MCP runtime initialization and backend registration
- `src/clis/` — atomic database commands and aggregate workflows
- `src/pipeline/` — YAML pipeline engine (fetch, map, filter, sort, limit, xml-parse)
- `src/databases/` — registered backend clients with shared retry/rate-limit infrastructure
- `src/datasets/` — Unimod and GDSC local snapshot loaders
- `src/execution.ts` — shared command validation/cache/timeout/hook boundary
- `src/batch-execution.ts` — shared generic and aggregate batch runtime
- `src/mcp-core.ts` — MCP routing, annotations, and result normalization
- `src/config.ts` — ~/.biocli/config.yaml management

Stable contracts are documented in `docs/contracts/hero-summary.md` and
`docs/contracts/run-artifacts.md`. Drug-target ranking changes must follow
`docs/methods/drug-target-ranking.md` and bump the method version.

## NCBI API Notes

- Rate limits: 3 req/sec without API key, 10 req/sec with key
- PubMed efetch only returns XML (no JSON mode)
- Configure API key: `biocli config set api_key YOUR_KEY`
