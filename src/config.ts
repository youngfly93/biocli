/**
 * Configuration management for biocli.
 *
 * Reads and writes ~/.biocli/config.yaml for persistent settings
 * such as API keys, email, and default output preferences.
 *
 * Priority for NCBI credentials:
 *   1. Environment variables (NCBI_API_KEY, NCBI_EMAIL)
 *   2. Config file (~/.biocli/config.yaml)
 *
 * Migration: if ~/.ncbicli/config.yaml exists and ~/.biocli/ does not,
 * the old config is automatically migrated on first load.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, cpSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import yaml from 'js-yaml';

// ── Types ────────────────────────────────────────────────────────────────────

export interface BiocliConfig {
  /** NCBI API key — get one at https://www.ncbi.nlm.nih.gov/account/settings/ */
  api_key?: string;
  /** Contact email (recommended by NCBI for E-utilities usage). */
  email?: string;
  /** Default settings applied when the user does not provide explicit flags. */
  defaults?: {
    /** Default output format (json, table, csv, etc.). */
    format?: string;
    /** Default maximum number of results to return. */
    limit?: number;
  };
  /** Cache settings. */
  cache?: {
    /** Whether caching is enabled (default: true). */
    enabled?: boolean;
    /** Cache TTL in hours (default: 24). */
    ttl?: number;
  };
}

/** @deprecated Use BiocliConfig instead. */
export type NcbiConfig = BiocliConfig;

// ── Paths ────────────────────────────────────────────────────────────────────

const CONFIG_DIR = join(homedir(), '.biocli');
const CONFIG_FILE = join(CONFIG_DIR, 'config.yaml');
const LEGACY_CONFIG_DIR = join(homedir(), '.ncbicli');
const LEGACY_CONFIG_FILE = join(LEGACY_CONFIG_DIR, 'config.yaml');

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Migrate legacy ~/.ncbicli/config.yaml → ~/.biocli/config.yaml (one-time).
 */
function migrateIfNeeded(): void {
  if (existsSync(CONFIG_DIR)) return; // already migrated or fresh install
  if (!existsSync(LEGACY_CONFIG_FILE)) return; // nothing to migrate

  try {
    mkdirSync(CONFIG_DIR, { recursive: true });
    cpSync(LEGACY_CONFIG_FILE, CONFIG_FILE);
    console.error(`Migrated config: ${LEGACY_CONFIG_FILE} → ${CONFIG_FILE}`);
  } catch {
    // Non-fatal — user can manually copy
  }
}

/**
 * Load the config file from disk. Returns an empty object if the file
 * does not exist or cannot be parsed.
 */
export function loadConfig(): BiocliConfig {
  migrateIfNeeded();
  if (!existsSync(CONFIG_FILE)) return {};

  try {
    const raw = readFileSync(CONFIG_FILE, 'utf-8');
    const parsed = yaml.load(raw);
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      return parsed as NcbiConfig;
    }
    return {};
  } catch {
    return {};
  }
}

/**
 * Persist the given config object to ~/.biocli/config.yaml.
 * Creates the directory if it does not exist.
 */
export function saveConfig(config: BiocliConfig): void {
  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true });
  }
  const content = yaml.dump(config, {
    indent: 2,
    lineWidth: 120,
    noRefs: true,
    sortKeys: true,
  });
  writeFileSync(CONFIG_FILE, content, 'utf-8');
}

/** Return the absolute path to the config file. */
export function getConfigPath(): string {
  return CONFIG_FILE;
}

/**
 * Resolve the NCBI API key.
 * Priority: env NCBI_API_KEY > config file api_key field.
 */
export function getApiKey(): string | undefined {
  return process.env.NCBI_API_KEY || loadConfig().api_key || undefined;
}

/**
 * Resolve the contact email.
 * Priority: env NCBI_EMAIL > config file email field.
 */
export function getEmail(): string | undefined {
  return process.env.NCBI_EMAIL || loadConfig().email || undefined;
}
