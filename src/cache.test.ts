import { describe, expect, it, beforeEach, afterAll } from 'vitest';
import { buildCacheKey, getCached, setCached, getStats, clearCache } from './cache.js';
import { rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

// Use a test-specific subdirectory to avoid interfering with real cache
// Note: These tests use the real cache dir but clean up after themselves

const TEST_DB = '_test_cache_';
const TEST_CMD = 'test/command';

function cleanup() {
  const testDir = join(homedir(), '.biocli', 'cache', TEST_DB);
  if (existsSync(testDir)) rmSync(testDir, { recursive: true, force: true });
}

describe('cache', () => {
  beforeEach(cleanup);
  afterAll(cleanup);

  describe('buildCacheKey', () => {
    it('produces stable keys for same args', () => {
      const k1 = buildCacheKey('ncbi', 'gene/search', { query: 'TP53', limit: 10 });
      const k2 = buildCacheKey('ncbi', 'gene/search', { limit: 10, query: 'TP53' });
      expect(k1).toBe(k2); // order-independent
    });

    it('produces different keys for different args', () => {
      const k1 = buildCacheKey('ncbi', 'gene/search', { query: 'TP53' });
      const k2 = buildCacheKey('ncbi', 'gene/search', { query: 'BRCA1' });
      expect(k1).not.toBe(k2);
    });
  });

  describe('getCached / setCached', () => {
    it('returns null for missing entry', () => {
      expect(getCached(TEST_DB, TEST_CMD, 'nonexistent')).toBeNull();
    });

    it('stores and retrieves data', () => {
      const data = [{ gene: 'TP53', id: '7157' }];
      setCached(TEST_DB, TEST_CMD, 'key1', data);
      expect(getCached(TEST_DB, TEST_CMD, 'key1')).toEqual(data);
    });

    it('returns null for expired entry', () => {
      setCached(TEST_DB, TEST_CMD, 'expired', { a: 1 }, 1); // 1ms TTL
      // Wait a tiny bit for expiry
      const start = Date.now();
      while (Date.now() - start < 5) { /* spin */ }
      expect(getCached(TEST_DB, TEST_CMD, 'expired')).toBeNull();
    });
  });

  describe('getStats', () => {
    it('counts entries', () => {
      setCached(TEST_DB, TEST_CMD, 's1', { a: 1 });
      setCached(TEST_DB, TEST_CMD, 's2', { a: 2 });
      const stats = getStats();
      expect(stats.totalEntries).toBeGreaterThanOrEqual(2);
    });
  });

  describe('clearCache', () => {
    it('removes all entries', () => {
      setCached(TEST_DB, TEST_CMD, 'c1', { a: 1 });
      const cleared = clearCache();
      expect(cleared).toBeGreaterThanOrEqual(1);
      expect(getCached(TEST_DB, TEST_CMD, 'c1')).toBeNull();
    });
  });
});
