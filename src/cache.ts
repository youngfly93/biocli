/**
 * Local file-based cache for biocli API responses.
 *
 * Cache layout: ~/.biocli/cache/{database}/{command}/{sha256}.json
 * Each entry stores: { data, cachedAt, ttlMs, key }
 *
 * TTL default: 24 hours. Configurable via `biocli config set cache.ttl <hours>`.
 * Disable per-request with --no-cache global flag.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, statSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { createHash } from 'node:crypto';

// ── Constants ────────────────────────────────────────────────────────────────

const CACHE_DIR = join(homedir(), '.biocli', 'cache');
const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

// ── Types ────────────────────────────────────────────────────────────────────

interface CacheEntry {
  data: unknown;
  cachedAt: number;
  ttlMs: number;
  key: string;
}

export interface CacheStats {
  totalEntries: number;
  totalSizeBytes: number;
  databases: Record<string, number>;
  oldestEntry: string | null;
  newestEntry: string | null;
}

// ── Core functions ───────────────────────────────────────────────────────────

/** Generate a cache key hash from command + args. */
function cacheHash(key: string): string {
  return createHash('sha256').update(key).digest('hex').slice(0, 16);
}

/** Build the cache file path for a given database, command, and args. */
function cachePath(database: string, command: string, argsKey: string): string {
  const dir = join(CACHE_DIR, database, command);
  return join(dir, `${cacheHash(argsKey)}.json`);
}

/** Build a stable cache key from command args. */
export function buildCacheKey(database: string, command: string, args: Record<string, unknown>): string {
  // Sort keys for stable hashing
  const sorted = Object.keys(args).sort().map(k => `${k}=${JSON.stringify(args[k])}`).join('&');
  return `${database}/${command}?${sorted}`;
}

/** Get a cached result if it exists and hasn't expired. */
export function getCached(database: string, command: string, argsKey: string, ttlMs?: number): unknown | null {
  const path = cachePath(database, command, argsKey);
  if (!existsSync(path)) return null;

  try {
    const raw = readFileSync(path, 'utf-8');
    const entry: CacheEntry = JSON.parse(raw);
    const effectiveTtl = ttlMs ?? entry.ttlMs ?? DEFAULT_TTL_MS;
    const age = Date.now() - entry.cachedAt;

    if (age > effectiveTtl) {
      // Expired — delete and return null
      try { rmSync(path); } catch { /* ignore */ }
      return null;
    }

    return entry.data;
  } catch {
    return null;
  }
}

/** Store a result in the cache. */
export function setCached(database: string, command: string, argsKey: string, data: unknown, ttlMs: number = DEFAULT_TTL_MS): void {
  const path = cachePath(database, command, argsKey);
  const dir = join(CACHE_DIR, database, command);

  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  const entry: CacheEntry = {
    data,
    cachedAt: Date.now(),
    ttlMs,
    key: argsKey,
  };

  writeFileSync(path, JSON.stringify(entry), 'utf-8');
}

// ── Management functions ─────────────────────────────────────────────────────

/** Get cache statistics. */
export function getStats(): CacheStats {
  const stats: CacheStats = {
    totalEntries: 0,
    totalSizeBytes: 0,
    databases: {},
    oldestEntry: null,
    newestEntry: null,
  };

  if (!existsSync(CACHE_DIR)) return stats;

  let oldestTime = Infinity;
  let newestTime = 0;

  function walkDir(dir: string, dbName?: string): void {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        walkDir(fullPath, dbName ?? entry.name);
      } else if (entry.name.endsWith('.json')) {
        const st = statSync(fullPath);
        stats.totalEntries++;
        stats.totalSizeBytes += st.size;
        if (dbName) {
          stats.databases[dbName] = (stats.databases[dbName] ?? 0) + 1;
        }
        if (st.mtimeMs < oldestTime) {
          oldestTime = st.mtimeMs;
          stats.oldestEntry = new Date(st.mtimeMs).toISOString();
        }
        if (st.mtimeMs > newestTime) {
          newestTime = st.mtimeMs;
          stats.newestEntry = new Date(st.mtimeMs).toISOString();
        }
      }
    }
  }

  walkDir(CACHE_DIR);
  return stats;
}

/** Clear all cache entries. Returns number of entries deleted. */
export function clearCache(): number {
  if (!existsSync(CACHE_DIR)) return 0;
  const stats = getStats();
  rmSync(CACHE_DIR, { recursive: true, force: true });
  return stats.totalEntries;
}

/** Get the default TTL in milliseconds. */
export function getDefaultTtlMs(): number {
  return DEFAULT_TTL_MS;
}
