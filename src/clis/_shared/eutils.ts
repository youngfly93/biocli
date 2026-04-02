/**
 * Shared E-utilities helpers for NCBI adapter commands.
 *
 * Re-exports the core buildEutilsUrl from ncbi-fetch so that adapter
 * files can import from a short, consistent path:
 *
 *   import { buildEutilsUrl, EUTILS_BASE } from '../_shared/eutils.js';
 */

export { EUTILS_BASE, buildEutilsUrl } from '../../ncbi-fetch.js';
