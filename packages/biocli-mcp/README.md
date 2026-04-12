# biocli-mcp

Optional MCP companion package for `biocli`.

This package keeps MCP transport and client-install logic out of the core CLI package.

## Repo-local usage

Build the core package first:

```bash
npm run build
node packages/biocli-mcp/cli.js serve --scope hero
node packages/biocli-mcp/cli.js install --dry-run
```

The companion package currently loads the built `biocli` core from the repo's `dist/` directory.
