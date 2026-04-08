# ADR 001: Defer Plugin Ecosystem to Post-v1.0

**Date**: 2026-04-03
**Status**: Accepted

## Context

biocli has internal plugin infrastructure: filesystem discovery (`~/.biocli/plugins/`), lifecycle hooks (`onStartup`, `onBeforeExecute`, `onAfterExecute`), and a registry API export (`@yangfei_93sky/biocli/registry`). However, there are no `plugin install/update/uninstall` commands, no published plugin examples, and no stability guarantees.

Comparison with opencli (which has a production-ready plugin lifecycle with install, update, uninstall, monorepo support, and published plugins) suggested formalizing this.

## Decision

Keep the plugin loading mechanism as internal infrastructure. Do not promote it as a public feature until after v1.0.

## Rationale

1. **Core focus**: biocli's value is agent-first structured output for biological databases, not extensibility. Engineering effort is better spent on data quality and agent experience.
2. **API stability**: At v0.2.0, the command interface is still evolving. Committing to a stable plugin API adds maintenance burden.
3. **No demand**: No external users have requested plugin support.
4. **Reversible**: The mechanism exists and works. Formalizing it later requires adding CLI commands and documentation, not rebuilding.

## Consequences

- `@yangfei_93sky/biocli/registry` exports are marked `@experimental`
- PLUGIN_DEV.md carries a stability warning
- README does not advertise plugin support
- Revisit after v1.0 when command output schemas are stable and at least 3 users request it
