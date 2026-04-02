/**
 * NCBI HTTP client — backward compatibility shim.
 *
 * All logic has moved to databases/ncbi.ts. This file re-exports
 * everything so that existing adapter imports continue to work:
 *
 *   import { createHttpContext } from '../ncbi-fetch.js';
 *   import { buildEutilsUrl } from '../ncbi-fetch.js';
 */

export {
  EUTILS_BASE,
  buildEutilsUrl,
  ncbiFetch,
  createHttpContext,
  ncbiBackend,
} from './databases/ncbi.js';
