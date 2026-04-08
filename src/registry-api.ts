/**
 * @experimental This API is pre-v1.0 and may change without notice.
 * See PLUGIN_DEV.md and docs/decisions/001-plugin-ecosystem.md.
 *
 * Public API re-exports for plugin authors and external consumers.
 *
 * Import from '@yangfei_93sky/biocli/registry' to register commands:
 *
 * ```ts
 * import { cli, Strategy } from '@yangfei_93sky/biocli/registry';
 * ```
 */

export { cli, Strategy, getRegistry, fullName, registerCommand } from './registry.js';
export type { CliCommand, Arg, CliOptions, CommandArgs } from './registry.js';
export type { HttpContext, NcbiFetchOptions } from './types.js';
