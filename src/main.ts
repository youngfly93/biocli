#!/usr/bin/env node
/**
 * biocli entry point.
 *
 * Bootstraps the runtime, then hands off to Commander.
 */

import { runCli } from './cli.js';
import { initializeBiocli } from './bootstrap.js';
import { printDeprecationIfLegacyName } from './deprecation.js';

// Warn on stderr when invoked as the legacy `ncbicli` binary. No-op when
// invoked as `biocli` or when BIOCLI_NO_DEPRECATION=1 is set.
printDeprecationIfLegacyName();

async function main(): Promise<void> {
  await initializeBiocli();
  runCli();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
