const { existsSync, readFileSync } = require('fs');
const { resolve } = require('path');

const root = resolve(__dirname, '..');
const pkgPath = resolve(root, 'package.json');
const recipePath = resolve(root, 'packaging/conda/recipe/meta.yaml');
const recipeReadmePath = resolve(root, 'packaging/conda/README.md');
const buildShPath = resolve(root, 'packaging/conda/recipe/build.sh');
const bldBatPath = resolve(root, 'packaging/conda/recipe/bld.bat');
const localBuildHelperPath = resolve(root, 'scripts/build-conda-local.sh');
const readmePath = resolve(root, 'README.md');
const licensePath = resolve(root, 'LICENSE');

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function read(path) {
  assert(existsSync(path), `Missing required file: ${path}`);
  return readFileSync(path, 'utf8');
}

try {
  const pkg = JSON.parse(read(pkgPath));
  const recipe = read(recipePath);
  const recipeReadme = read(recipeReadmePath);
  const buildSh = read(buildShPath);
  const bldBat = read(bldBatPath);
  const localBuildHelper = read(localBuildHelperPath);
  const readme = read(readmePath);

  assert(existsSync(licensePath), 'Missing LICENSE for conda recipe metadata');
  assert(recipe.includes(`{% set version = "${pkg.version}" %}`), 'Conda recipe version does not match package.json');
  assert(recipe.includes('path: ../../..'), 'Conda recipe source.path must point at the repository root');
  assert(recipe.includes('nodejs >=20'), 'Conda recipe must require nodejs >=20');
  assert(!recipe.includes('\n    - npm\n'), 'Conda recipe must not declare a standalone npm host dependency');
  assert(!recipe.includes('\n  script:\n'), 'Conda recipe must not define build.script when build.sh / bld.bat are present');
  assert(recipe.includes('biocli --version'), 'Conda recipe is missing the biocli --version smoke check');
  assert(recipe.includes('biocli schema'), 'Conda recipe is missing the schema smoke check');
  assert(recipe.includes('biocli list -f json'), 'Conda recipe is missing the list -f json smoke check');
  assert(recipe.includes('biocli methods - --format text'), 'Conda recipe is missing the methods smoke check');

  assert(buildSh.includes('npm install --ignore-scripts'), 'Unix conda build script must install npm dependencies');
  assert(buildSh.includes('npm run build'), 'Unix conda build script must compile dist assets');
  assert(buildSh.includes('ln -sf "${install_root}/dist/main.js" "${PREFIX}/bin/biocli"'), 'Unix conda build script must expose the biocli binary');
  assert(buildSh.includes('ln -sf "${install_root}/dist/main.js" "${PREFIX}/bin/ncbicli"'), 'Unix conda build script must expose the ncbicli alias');

  assert(bldBat.includes('call npm install --ignore-scripts'), 'Windows conda build script must install npm dependencies');
  assert(bldBat.includes('call npm run build'), 'Windows conda build script must compile dist assets');
  assert(bldBat.includes('biocli.cmd'), 'Windows conda build script must expose the biocli launcher');
  assert(bldBat.includes('ncbicli.cmd'), 'Windows conda build script must expose the ncbicli launcher');

  assert(localBuildHelper.includes('BIOCLI_CONDA_CACHE_ROOT'), 'Local conda helper must allow overriding the conda cache root');
  assert(localBuildHelper.includes('CONDA_BLD_PATH'), 'Local conda helper must isolate the conda build root');

  assert(readme.includes('conda install -c bioconda -c conda-forge biocli'), 'Top-level README must document the preferred conda install command');
  assert(readme.includes('packaging/conda/README.md'), 'Top-level README must link to conda packaging docs');
  assert(readme.includes('packages/biocli-mcp'), 'Top-level README must document the optional MCP companion package');
  assert(readme.includes('node packages/biocli-mcp/cli.js install --dry-run'), 'Top-level README must document MCP install via the companion package');

  assert(recipeReadme.includes('npm run verify:conda'), 'Conda packaging README must document static scaffold verification');
  assert(recipeReadme.includes('npm run build:conda:local'), 'Conda packaging README must document the local conda build helper');
  assert(recipeReadme.includes('several GB'), 'Conda packaging README must warn about local disk usage');
  assert(recipeReadme.includes('BIOCLI_CONDA_CACHE_ROOT'), 'Conda packaging README must document overriding the conda cache root');

  console.log('conda scaffold verification passed');
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
