/**
 * Remove AppleDouble/resource-fork files (._*) from one or more directories.
 *
 * These appear automatically on exFAT / FAT32 volumes used on macOS.
 * They are binary garbage that breaks parsing, pollutes benchmark trees,
 * and should never be treated as real artifacts.
 */
const { readdirSync, rmSync, existsSync, statSync } = require('fs');
const path = require('path');

let removed = 0;
const roots = process.argv.slice(2);
if (roots.length === 0) roots.push('dist');

function walk(dir) {
  if (!existsSync(dir)) return;
  for (const f of readdirSync(dir)) {
    const fp = path.join(dir, f);
    if (statSync(fp).isDirectory()) {
      walk(fp);
    } else if (f.startsWith('._')) {
      rmSync(fp);
      removed++;
    }
  }
}

for (const root of roots) walk(root);
if (removed > 0) {
  process.stdout.write(`Cleaned ${removed} AppleDouble files from ${roots.join(', ')}\n`);
}
