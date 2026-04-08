/**
 * biocli unimod fetch — Install the Unimod modification dictionary locally.
 *
 * First-run download. If the dataset is already installed, this is a no-op.
 * To force re-download, use `biocli unimod refresh` instead.
 *
 * Unimod is distributed as a static XML dump (no REST API) — biocli caches
 * it in `~/.biocli/datasets/unimod.xml` after an integrity check.
 *
 * Data: Unimod (https://www.unimod.org), Design Science License.
 */

import chalk from 'chalk';
import { cli } from '../../registry.js';
import { refreshUnimod, unimodPaths, UNIMOD_ATTRIBUTION } from '../../datasets/unimod.js';

cli({
  site: 'unimod',
  name: 'fetch',
  database: 'unimod',
  description:
    'Install the Unimod PTM dictionary locally (no-op if already installed). ' +
    'Data: Unimod (https://www.unimod.org), Design Science License.',
  args: [],
  func: async (_ctx, _args) => {
    const meta = await refreshUnimod({ force: false });
    const paths = unimodPaths();
    console.error(chalk.dim(`Unimod installed: ${meta.modCount} mods at ${paths.xml}`));
    console.error(chalk.dim(`Fetched: ${meta.fetchedAt}`));
    console.error(chalk.dim(UNIMOD_ATTRIBUTION));
    return null;
  },
});
