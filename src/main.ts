#!/usr/bin/env node
/**
 * biocli entry point.
 *
 * Discovers built-in and user CLI definitions, loads plugins,
 * fires the onStartup hook, then hands off to Commander.
 */

// MUST be the first import: side-effect installs undici dispatcher with
// autoSelectFamily before any other module evaluation. Fixes WSL2 / dual-stack
// IPv6 hangs (issue #1).
import './http-dispatcher.js';

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { discoverClis, discoverPlugins } from './discovery.js';
import { runCli } from './cli.js';
import { emitHook } from './hooks.js';
import { printDeprecationIfLegacyName } from './deprecation.js';

// Register database backends (side-effect imports)
import './databases/ncbi.js';
import './databases/uniprot.js';
import './databases/kegg.js';
import './databases/string-db.js';
import './databases/ensembl.js';
import './databases/enrichr.js';
import './databases/proteomexchange.js';
import './databases/pride.js';

// Warn on stderr when invoked as the legacy `ncbicli` binary. No-op when
// invoked as `biocli` or when BIOCLI_NO_DEPRECATION=1 is set.
printDeprecationIfLegacyName();

const __dirname = dirname(fileURLToPath(import.meta.url));
const BUILTIN_CLIS = join(__dirname, 'clis');

async function main(): Promise<void> {
  await discoverClis(BUILTIN_CLIS);
  await discoverPlugins();
  await emitHook('onStartup', { command: '__startup__', args: {} });
  runCli();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
