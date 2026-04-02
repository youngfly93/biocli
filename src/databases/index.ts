/**
 * Database backend abstraction layer.
 *
 * Each supported database (NCBI, UniProt, KEGG, STRING, Ensembl, Enrichr)
 * implements the DatabaseBackend interface and registers itself here.
 * The execution layer uses createHttpContextForDatabase() to get the
 * right HTTP client for each command.
 */

import type { HttpContext } from '../types.js';

// ── Backend interface ─────────────────────────────────────────────────────────

export interface DatabaseBackend {
  /** Unique identifier (e.g. 'ncbi', 'uniprot', 'kegg'). */
  readonly id: string;
  /** Human-readable name (e.g. 'NCBI', 'UniProt'). */
  readonly name: string;
  /** Base URL for the API. */
  readonly baseUrl: string;
  /** Default rate limit: max requests per second. */
  readonly rateLimit: number;
  /** Create an HttpContext bound to this database's rate limiter and auth. */
  createContext(): HttpContext;
}

// ── Backend registry ──────────────────────────────────────────────────────────

declare global {
  // eslint-disable-next-line no-var
  var __biocli_backends__: Map<string, DatabaseBackend> | undefined;
}

const _backends: Map<string, DatabaseBackend> =
  globalThis.__biocli_backends__ ??= new Map();

/** Register a database backend. */
export function registerBackend(backend: DatabaseBackend): void {
  _backends.set(backend.id, backend);
}

/** Get a registered backend by ID, or undefined if not found. */
export function getBackend(id: string): DatabaseBackend | undefined {
  return _backends.get(id);
}

/** Get all registered backends. */
export function getAllBackends(): DatabaseBackend[] {
  return [..._backends.values()];
}

/**
 * Create an HttpContext for a specific database.
 *
 * This is the main entry point used by execution.ts. It replaces the
 * NCBI-hardcoded createHttpContext() with a database-aware factory.
 *
 * Lookup strategy:
 *   1. Exact match on databaseId (e.g. 'ncbi', 'uniprot')
 *   2. If not found and looks like an NCBI sub-database (pubmed, gene, etc.),
 *      fall back to the 'ncbi' backend
 *
 * For 'aggregate' commands (which need multiple databases), the command's
 * func() creates its own contexts — this function is not called.
 */
export function createHttpContextForDatabase(databaseId: string): HttpContext {
  // Direct match
  let backend = _backends.get(databaseId);

  // Fallback: NCBI sub-database names (pubmed, gene, gds, sra, clinvar, snp, taxonomy)
  // route to the 'ncbi' backend
  if (!backend && _backends.has('ncbi')) {
    backend = _backends.get('ncbi');
  }

  if (!backend) {
    throw new Error(
      `Unknown database backend: "${databaseId}". ` +
      `Available: ${[..._backends.keys()].join(', ') || '(none registered)'}`,
    );
  }
  return backend.createContext();
}
