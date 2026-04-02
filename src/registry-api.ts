/**
 * Public API re-exports for plugin authors and external consumers.
 *
 * Import from '@biocli/ncbicli/registry' to register commands:
 *
 * ```ts
 * import { cli, Strategy } from '@biocli/ncbicli/registry';
 * ```
 */

export { cli, Strategy, getRegistry, fullName, registerCommand } from './registry.js';
export type { CliCommand, Arg, CliOptions, CommandArgs } from './registry.js';
export type { HttpContext, NcbiFetchOptions } from './types.js';
