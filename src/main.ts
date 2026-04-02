#!/usr/bin/env node
/**
 * ncbicli entry point.
 *
 * Discovers built-in and user CLI definitions, loads plugins,
 * fires the onStartup hook, then hands off to Commander.
 */

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { discoverClis, discoverPlugins } from './discovery.js';
import { runCli } from './cli.js';
import { emitHook } from './hooks.js';

// Register database backends (side-effect imports)
import './databases/ncbi.js';

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
