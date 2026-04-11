/**
 * Shared bootstrap for biocli runtime consumers.
 *
 * Initializes the HTTP dispatcher, registers built-in database backends,
 * discovers built-in/user commands, discovers plugins, and fires the
 * startup hook exactly once per process.
 */

// MUST be the first import: side-effect installs undici dispatcher with
// autoSelectFamily before any other module evaluation. Fixes WSL2 / dual-stack
// IPv6 hangs (issue #1).
import './http-dispatcher.js';

import { discoverClis, discoverPlugins, BUILTIN_CLIS_DIR } from './discovery.js';
import { emitHook } from './hooks.js';

// Register database backends (side-effect imports)
import './databases/ncbi.js';
import './databases/uniprot.js';
import './databases/kegg.js';
import './databases/string-db.js';
import './databases/ensembl.js';
import './databases/enrichr.js';
import './databases/proteomexchange.js';
import './databases/pride.js';
import './databases/cbioportal.js';
import './databases/opentargets.js';
import './databases/gdsc.js';

export interface BootstrapOptions {
  discoverUserPlugins?: boolean;
  emitStartupHook?: boolean;
}

let _bootstrapPromise: Promise<void> | null = null;

export async function initializeBiocli(opts: BootstrapOptions = {}): Promise<void> {
  if (_bootstrapPromise) return _bootstrapPromise;

  const discoverUserPlugins = opts.discoverUserPlugins ?? true;
  const emitStartupHook = opts.emitStartupHook ?? true;

  _bootstrapPromise = (async () => {
    await discoverClis(BUILTIN_CLIS_DIR);
    if (discoverUserPlugins) {
      await discoverPlugins();
    }
    if (emitStartupHook) {
      await emitHook('onStartup', { command: '__startup__', args: {} });
    }
  })().catch((error) => {
    _bootstrapPromise = null;
    throw error;
  });

  return _bootstrapPromise;
}
