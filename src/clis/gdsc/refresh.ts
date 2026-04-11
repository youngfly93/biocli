/**
 * biocli gdsc refresh — Force re-download of GDSC bulk files and rebuild index.
 */

import chalk from 'chalk';
import { cli } from '../../registry.js';
import { createHttpContextForDatabase } from '../../databases/index.js';
import { gdscPaths, loadGdscSensitivityIndex, refreshGdscDataset } from '../../datasets/gdsc.js';

cli({
  site: 'gdsc',
  name: 'refresh',
  database: 'gdsc',
  noContext: true,
  description:
    'Force re-download of official GDSC files and rebuild the local sensitivity index.',
  args: [],
  func: async (_ctx, _args) => {
    const gdscCtx = createHttpContextForDatabase('gdsc');
    const meta = await refreshGdscDataset(gdscCtx, { force: true });
    const index = await loadGdscSensitivityIndex(gdscCtx);
    const paths = gdscPaths();

    console.error(chalk.dim(`GDSC refreshed: ${Object.keys(index.drugs).length} indexed compounds`));
    console.error(chalk.dim(`Release: ${meta.release}`));
    console.error(chalk.dim(`Fetched: ${meta.fetchedAt}`));
    console.error(chalk.dim(`Index: ${paths.index}`));
    return null;
  },
});

