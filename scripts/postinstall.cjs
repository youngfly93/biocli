#!/usr/bin/env node

/**
 * postinstall script — create ~/.biocli/ configuration directory.
 *
 * This script is intentionally plain CommonJS so that it can run before any
 * TypeScript build output exists.
 */

const { mkdirSync, existsSync } = require('node:fs');
const { join } = require('node:path');
const { homedir } = require('node:os');

function main() {
  if (process.env.CI || process.env.CONTINUOUS_INTEGRATION) return;

  const configDir = join(homedir(), '.biocli');

  try {
    if (!existsSync(configDir)) {
      mkdirSync(configDir, { recursive: true });
      console.log(`Created configuration directory: ${configDir}`);
    }
  } catch (err) {
    if (process.env.BIOCLI_VERBOSE) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`Warning: Could not create config directory: ${message}`);
    }
  }
}

main();
