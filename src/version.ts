/**
 * Version string reader for ncbicli.
 *
 * Reads the version from package.json at runtime. Handles both
 * development (src/) and production (dist/) directory layouts.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

let _version: string | undefined;

/**
 * Return the current ncbicli version string from package.json.
 *
 * The result is cached after the first call. Falls back to '0.0.0'
 * if package.json cannot be found or parsed.
 */
export function getVersion(): string {
  if (_version) return _version;

  const __dirname = dirname(fileURLToPath(import.meta.url));

  // Try dist/../package.json first (production), then src/../package.json (dev)
  for (const rel of ['..', '../..']) {
    try {
      const pkgPath = join(__dirname, rel, 'package.json');
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
      const v: string = pkg.version ?? '0.0.0';
      _version = v;
      return v;
    } catch {
      // Try next relative path
    }
  }

  _version = '0.0.0';
  return _version;
}
