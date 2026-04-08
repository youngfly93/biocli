/**
 * biocli unimod refresh — Force re-download of the Unimod dictionary.
 *
 * Always re-fetches from upstream regardless of whether a cache exists.
 * Use this when Unimod has been updated upstream and you want the latest
 * entries, or when `biocli doctor` reports the cache as stale.
 *
 * Data: Unimod (https://www.unimod.org), Design Science License.
 */

import chalk from 'chalk';
import { cli } from '../../registry.js';
import { refreshUnimod, unimodPaths, UNIMOD_ATTRIBUTION } from '../../datasets/unimod.js';

cli({
  site: 'unimod',
  name: 'refresh',
  database: 'unimod',
  noContext: true,
  description:
    'Force re-download of the Unimod PTM dictionary (bypasses the local cache). ' +
    'Data: Unimod (https://www.unimod.org), Design Science License.',
  args: [],
  func: async (_ctx, _args) => {
    const meta = await refreshUnimod({ force: true });
    const paths = unimodPaths();
    console.error(chalk.dim(`Unimod refreshed: ${meta.modCount} mods at ${paths.xml}`));
    console.error(chalk.dim(`Fetched: ${meta.fetchedAt}`));
    if (meta.sha256) {
      console.error(chalk.dim(`SHA-256: ${meta.sha256.slice(0, 16)}…`));
    }
    console.error(chalk.dim(UNIMOD_ATTRIBUTION));
    return null;
  },
});
