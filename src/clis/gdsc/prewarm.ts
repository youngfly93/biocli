/**
 * biocli gdsc prewarm — Download GDSC bulk files and build the local index.
 *
 * Unlike live API backends, GDSC sensitivity evidence is backed by official
 * bulk release files. This command makes the first-run cost explicit so hero
 * workflows like `aggregate drug-target` do not need to hide the initial
 * download + index build inside an analysis request.
 */

import chalk from 'chalk';
import { cli } from '../../registry.js';
import { createHttpContextForDatabase } from '../../databases/index.js';
import { gdscPaths, loadGdscSensitivityIndex, refreshGdscDataset } from '../../datasets/gdsc.js';

cli({
  site: 'gdsc',
  name: 'prewarm',
  aliases: ['install'],
  database: 'gdsc',
  noContext: true,
  description:
    'Download official GDSC files and build the local sensitivity index (no-op if already warm).',
  args: [],
  func: async (_ctx, _args) => {
    const gdscCtx = createHttpContextForDatabase('gdsc');
    const meta = await refreshGdscDataset(gdscCtx, { force: false });
    const index = await loadGdscSensitivityIndex(gdscCtx);
    const paths = gdscPaths();

    console.error(chalk.dim(`GDSC prewarmed: ${Object.keys(index.drugs).length} indexed compounds`));
    console.error(chalk.dim(`Release: ${meta.release}`));
    console.error(chalk.dim(`Fetched: ${meta.fetchedAt}`));
    console.error(chalk.dim(`Index: ${paths.index}`));
    return null;
  },
});

