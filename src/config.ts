/**
 * Configuration management for ncbicli.
 *
 * Reads and writes ~/.ncbicli/config.yaml for persistent settings
 * such as API key, email, and default output preferences.
 *
 * Priority for credentials:
 *   1. Environment variables (NCBI_API_KEY, NCBI_EMAIL)
 *   2. Config file (~/.ncbicli/config.yaml)
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import yaml from 'js-yaml';

// ── Types ────────────────────────────────────────────────────────────────────

export interface NcbiConfig {
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
}

// ── Paths ────────────────────────────────────────────────────────────────────

const CONFIG_DIR = join(homedir(), '.ncbicli');
const CONFIG_FILE = join(CONFIG_DIR, 'config.yaml');

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Load the config file from disk. Returns an empty object if the file
 * does not exist or cannot be parsed.
 */
export function loadConfig(): NcbiConfig {
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
 * Persist the given config object to ~/.ncbicli/config.yaml.
 * Creates the directory if it does not exist.
 */
export function saveConfig(config: NcbiConfig): void {
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
