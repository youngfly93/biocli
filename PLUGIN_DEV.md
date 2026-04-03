# Plugin Development (Experimental)

> **Status**: The plugin loading mechanism exists and works, but is **not officially supported** as a public API. The interface may change without notice before v1.0.

## How Plugins Work

biocli discovers plugins from `~/.biocli/plugins/`. On startup, it scans this directory for:

1. **Single-file plugins**: `.ts` or `.js` files containing `cli()` calls
2. **Directory plugins**: Folders with `package.json` pointing to a main entry

Plugins use the same `cli()` function as built-in adapters:

```ts
import { cli, Strategy } from '@biocli/cli/registry';

cli({
  site: 'myplugin',
  name: 'command',
  database: 'custom',
  strategy: Strategy.PUBLIC,
  args: [{ name: 'input', positional: true, required: true }],
  columns: ['field1', 'field2'],
  func: async (ctx, args) => {
    // Your logic here
    return [{ field1: 'value', field2: 'value' }];
  },
});
```

## Lifecycle Hooks

Plugins can tap into biocli's execution lifecycle:

```ts
import { onStartup, onBeforeExecute, onAfterExecute } from '@biocli/cli/registry';

onStartup(async () => { /* runs after all commands discovered */ });
onBeforeExecute(async (ctx) => { /* runs before each command */ });
onAfterExecute(async (ctx, result) => { /* runs after each command */ });
```

## Stability Warning

- The plugin API is pre-v1.0 and **may change without notice**
- No `plugin install/update/uninstall` commands exist yet
- No semver guarantees for the `@biocli/cli/registry` export
- For production use, pin to a specific biocli version

## Future Plans

Plugin ecosystem formalization is deferred to post-v1.0. See `docs/decisions/001-plugin-ecosystem.md` for rationale.
