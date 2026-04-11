# Conda Packaging

This directory contains the initial conda packaging scaffold for `biocli`.

## Intended install paths

When a public conda channel exists, the preferred user-facing command will be:

```bash
conda install -c bioconda -c conda-forge biocli
```

Until then, there are two practical paths:

### 1. Conda-managed environment + npm

```bash
conda create -n biocli -c conda-forge "nodejs>=20"
conda activate biocli
npm install -g @yangfei_93sky/biocli
```

### 2. Local conda package build

```bash
npm run verify:conda
npm run build:conda:local
conda install -c local biocli
```

## Recipe layout

- `recipe/meta.yaml`: conda metadata, runtime deps, and smoke commands
- `recipe/build.sh`: Unix build/install script
- `recipe/bld.bat`: Windows build/install script
- `recipe/methods-fixture.json`: tiny offline fixture for recipe smoke tests

## Local validation workflow

Run the static scaffold check first:

```bash
npm run verify:conda
```

Then, if `conda-build` is available and you have enough disk, use the local helper:

```bash
npm run build:conda:local
```

The helper avoids your base conda cache and picks a cache root automatically:

- native/local filesystems: `./.conda`
- repositories under `/Volumes/...`: a temp-directory cache root on the system disk

You can override that choice with `BIOCLI_CONDA_CACHE_ROOT=/absolute/path`.

## Disk and cache notes

Local conda validation can consume several GB of temporary packages, especially the first time `conda-build` is installed or the first time the recipe is solved.

- Expect to need several GB of free space before running `npm run build:conda:local`.
- If your repository lives on `/Volumes/...`, the helper will prefer the system temp directory to avoid AppleDouble `._*` corruption inside conda environments.
- If a build fails midway, inspect the cache root printed by the helper before retrying.
- If you need to reclaim space, remove that cache root after confirming it only contains temporary packaging caches.

## Release maintenance

Before publishing a new release line:

1. Sync the version in `recipe/meta.yaml` with `package.json`.
2. Run `npm run verify:conda`.
3. Build and test the npm package first.
4. Run a local conda build if `conda-build` is available and the machine has sufficient free disk.
5. After a public conda channel exists, verify both `conda install` and `biocli verify --smoke`.

## Current limitation

This scaffold is designed to make local conda packaging and channel preparation straightforward.
It has not yet been wired into an automated feedstock release flow.
