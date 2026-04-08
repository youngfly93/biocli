/**
 * Legacy `ncbicli` binary deprecation helper.
 *
 * The package exposes two `bin` entries (biocli and ncbicli) for the
 * ncbicli → biocli rename. When invoked via the legacy name, we print a
 * one-line notice on stderr so users learn about the new name without
 * polluting stdout (which agents parse as JSON).
 */

/**
 * Returns true when the binary was invoked via the legacy `ncbicli` shim.
 * Pure function — exported so unit tests can probe it without importing
 * src/main.ts (which has CLI registration side effects).
 *
 * Uses a platform-agnostic basename so the test suite can validate both
 * POSIX (`/usr/local/bin/ncbicli`) and Windows (`...\\ncbicli.cmd`) paths
 * regardless of which OS the tests run on.
 */
export function isLegacyInvocation(argv1: string | undefined): boolean {
  if (!argv1) return false;
  const lastSep = Math.max(argv1.lastIndexOf('/'), argv1.lastIndexOf('\\'));
  const base = lastSep >= 0 ? argv1.slice(lastSep + 1) : argv1;
  const name = base.replace(/\.(cmd|exe|ps1|js)$/i, '');
  return name === 'ncbicli';
}

/**
 * Writes a one-line deprecation notice to stderr when invoked via the
 * legacy `ncbicli` binary. No-op when:
 *
 * - `BIOCLI_NO_DEPRECATION=1` is set in the environment
 * - `--get-completions` is in argv (shell-completion output must stay clean)
 * - the binary was invoked as `biocli` (the new canonical name)
 */
export function printDeprecationIfLegacyName(): void {
  if (process.env.BIOCLI_NO_DEPRECATION === '1') return;
  if (process.argv.includes('--get-completions')) return;
  if (!isLegacyInvocation(process.argv[1])) return;
  process.stderr.write(
    "biocli: 'ncbicli' command is deprecated; use 'biocli' instead. " +
    "Set BIOCLI_NO_DEPRECATION=1 to silence.\n"
  );
}
