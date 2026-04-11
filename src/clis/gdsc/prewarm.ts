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
  readOnly: false,
  sideEffects: ['writes-filesystem', 'downloads-remote-files', 'updates-local-dataset-cache'],
  artifacts: [
    { path: '<datasets-dir>/gdsc/', kind: 'directory', description: 'Local GDSC dataset cache directory' },
    { path: '<datasets-dir>/gdsc/screened_compounds_rel_8.5.csv', kind: 'file', description: 'GDSC screened compounds table' },
    { path: '<datasets-dir>/gdsc/GDSC1_fitted_dose_response_27Oct23.xlsx', kind: 'file', description: 'Cached GDSC1 dose-response workbook' },
    { path: '<datasets-dir>/gdsc/GDSC2_fitted_dose_response_27Oct23.xlsx', kind: 'file', description: 'Cached GDSC2 dose-response workbook' },
    { path: '<datasets-dir>/gdsc/gdsc.meta.json', kind: 'file', description: 'Metadata for the cached GDSC release' },
    { path: '<datasets-dir>/gdsc/gdsc.sensitivity-index.v1.json', kind: 'file', description: 'Built sensitivity index (version suffix may change)' },
  ],
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
