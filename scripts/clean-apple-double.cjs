/**
 * Remove AppleDouble/resource-fork files (._*) from dist/.
 *
 * These appear automatically on exFAT / FAT32 volumes used on macOS.
 * They are binary garbage that breaks YAML parsing and bloats the build.
 */
const { readdirSync, rmSync, existsSync, statSync } = require('fs');
const path = require('path');

let removed = 0;

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

walk('dist');
if (removed > 0) {
  process.stdout.write(`Cleaned ${removed} AppleDouble files from dist/\n`);
}
