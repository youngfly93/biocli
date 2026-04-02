#!/usr/bin/env node

/**
 * postinstall script — create ~/.ncbicli/ configuration directory.
 *
 * This script is intentionally plain Node.js (no TypeScript, no imports from
 * the main source tree) so that it can run without a build step.
 *
 * Uses CommonJS to ensure compatibility across all Node.js environments,
 * since this runs before the project is built.
 */

const { mkdirSync, existsSync } = require('fs');
const { join } = require('path');
const { homedir } = require('os');

function main() {
  // Skip in CI environments
  if (process.env.CI || process.env.CONTINUOUS_INTEGRATION) {
    return;
  }

  const home = homedir();
  const ncbicliDir = join(home, '.ncbicli');

  try {
    if (!existsSync(ncbicliDir)) {
      mkdirSync(ncbicliDir, { recursive: true });
      console.log(`Created configuration directory: ${ncbicliDir}`);
    }
  } catch (err) {
    // postinstall is best-effort; never fail the package install
    if (process.env.NCBICLI_VERBOSE) {
      console.error(`Warning: Could not create config directory: ${err.message}`);
    }
  }
}

main();
