# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build & Test Commands

```bash
npm run build            # Full build: clean + tsc + copy YAML + build manifest
npm run typecheck        # Type check only (tsc --noEmit)
npm test                 # Unit tests (non-adapter)
npm run test:adapter     # Adapter tests (live NCBI API)
npm run test:all         # All test projects
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
- All adapters use E-utilities base URL from `_shared/eutils.ts`

## Architecture

- `src/clis/` — NCBI database adapters (pubmed, gene, geo, sra, etc.)
- `src/pipeline/` — YAML pipeline engine (fetch, map, filter, sort, limit, xml-parse)
- `src/ncbi-fetch.ts` — NCBI-aware HTTP client with rate limiting and API key injection
- `src/config.ts` — ~/.ncbicli/config.yaml management

## NCBI API Notes

- Rate limits: 3 req/sec without API key, 10 req/sec with key
- PubMed efetch only returns XML (no JSON mode)
- Configure API key: `ncbicli config set api_key YOUR_KEY`
