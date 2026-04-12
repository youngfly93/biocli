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
