# Release Checklist

Release checklist for `@yangfei_93sky/biocli`.

This document is optimized for the current project state:
- npm package: `@yangfei_93sky/biocli`
- binary: `biocli`
- current release line: `0.x`
- repository: `youngfly93/biocli`

Use this for every public release, including patch releases.

## Release Types

### Patch

Use for bug fixes, docs fixes, benchmark fixes, and low-risk CLI UX improvements.

Examples:
- parser fix
- error message fix
- benchmark scoring fix
- docs-only corrections

### Minor

Use for new commands, new workflow features, new output schema fields, or meaningful agent-facing improvements that remain backward compatible.

Examples:
- new workflow command
- new download mode
- new agent contract field
- new database command

### Breaking

Use for command renames, incompatible JSON shape changes, or CLI behavior changes that could break scripts or agents.

Examples:
- removing fields from `BiocliResult`
- changing command names
- changing default output behavior in a non-backward-compatible way

## Pre-Release Gate

All of the following should be true before publishing.

### Product and Docs

- [ ] `package.json` version is updated.
- [ ] `README.md` reflects the current command count, workflow count, and benchmark summary.
- [ ] benchmark claims in `README.md` match files in `benchmarks/results/<date>/`.
- [ ] `benchmarks/tasks.yaml` uses pinned competitor versions, not `latest`.
- [ ] no duplicate or stale sections remain in `README.md`.
- [ ] release notes summary is drafted.

### Repo Hygiene

- [ ] `git status --short` is clean except for intended release edits.
- [ ] remove accidental `._*` / `.DS_Store` files from the repo tree.
- [ ] generated benchmark artifacts included in the release are intentional.

Suggested cleanup check:

```bash
find . -name '._*' -o -name '.DS_Store'
```

### Validation

Run all core checks:

```bash
npm run typecheck
npm run test:all
npm run smoke:core
npm run build
```

Optional but recommended before a public release:

```bash
npm run smoke:live
```

### Benchmark Integrity

If the benchmark is mentioned in the release:

- [ ] raw outputs exist under `benchmarks/results/<date>/raw/`.
- [ ] scored outputs exist under `benchmarks/results/<date>/scored/`.
- [ ] `summary.json` contains pinned tool versions and `scoredAt`.
- [ ] automated scoring and manual audit are clearly distinguished.
- [ ] README benchmark table matches `summary.json`.

### Installability Check

Before `npm publish`, verify the packed artifact locally.

```bash
npm pack
tar -tf biocli-*.tgz | sed -n '1,80p'
```

Check that the tarball contains:
- `dist/main.js`
- `dist/cli-manifest.json`
- required YAML assets
- package metadata

Then validate the packed artifact in a clean temp project:

```bash
npm install ./biocli-*.tgz
./node_modules/.bin/biocli --version
./node_modules/.bin/biocli verify --smoke -f json
```

## Release Execution

Recommended order:

1. Bump version
2. Validate locally
3. Commit
4. Tag
5. Publish to npm
6. Push branch and tags
7. Create GitHub Release
8. Verify install from registry

### 1. Version Bump

Update the version in `package.json`.

If you are using npm versioning:

```bash
npm version patch
```

or:

```bash
npm version minor
```

If you bump manually, make sure `package-lock.json` stays in sync.

### 2. Local Validation

```bash
npm run typecheck
npm run test:all
npm run smoke:core
npm run build
```

Recommended:

```bash
npm run smoke:live
```

### 3. Commit

Example:

```bash
git add .
git commit -m "release: v0.2.1"
```

### 4. Tag

```bash
git tag -a v0.2.1 -m "v0.2.1"
```

### 5. Publish to npm

First verify auth:

```bash
npm config get registry
npm whoami
```

Then publish:

```bash
npm publish --access public
```

Notes:
- confirm the registry is the one you intend to publish to before running `npm publish`
- `prepublishOnly` already runs `npm run build`.
- do not publish if local validation has not passed.

### 6. Push Branch and Tags

```bash
git push origin main
git push origin --tags
```

### 7. Create GitHub Release

Create a GitHub release for the tag and paste the release notes summary.

Minimum release notes should include:
- release version
- major fixes
- new commands or workflow changes
- agent contract changes
- benchmark or docs changes if relevant

### 8. Verify Registry Install

In a clean environment, verify the public package:

```bash
npm install -g @yangfei_93sky/biocli
biocli --version
biocli verify --smoke -f json
```

Also verify at least one workflow and one atomic command:

```bash
biocli aggregate gene-dossier TP53 -f json
biocli gene info 7157 -f json
```

## Post-Release Checks

- [ ] npm package page shows the new version.
- [ ] GitHub release is visible and linked to the correct tag.
- [ ] `biocli --version` matches the published version.
- [ ] install instructions in `README.md` still work.
- [ ] benchmark links in README resolve correctly.
- [ ] no obvious install or startup issues are reported.

## Release Notes Template

Use this as a minimal template:

```md
## biocli vX.Y.Z

### Highlights
- ...

### Fixes
- ...

### Agent / Contract Changes
- ...

### Workflow / Download Changes
- ...

### Verification
- `npm run typecheck`
- `npm run test:all`
- `npm run smoke:core`
- `npm run build`
```

## Rollback / Hotfix

If a bad release is published:

1. Stop promoting the broken version.
2. Open a hotfix branch immediately.
3. Publish a fixed patch version instead of trying to mutate the existing release.
4. Update GitHub Release notes to mark the broken version as superseded.

Do not rely on unpublish except for cases where the registry policy allows it and the release is brand new.

## biocli-Specific Reminders

- `README.md` currently contains benchmark-driven positioning. Re-check those numbers on every release.
- `benchmarks/tasks.yaml` should not say `latest` for competitor versions in a public benchmark release.
- `smoke:live` is recommended before public release because this CLI depends on live upstream APIs.
- protect agent-facing compatibility:
  - do not silently break `help --json`
  - do not silently break `help --contract`
  - do not silently break `schema` refs
  - do not silently rename workflow fields in `BiocliResult`

## Sign-Off

- [ ] Ready to publish to npm
- [ ] Ready to tag and push
- [ ] Ready to create GitHub Release
- [ ] Ready to announce or share externally
