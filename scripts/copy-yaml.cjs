/**
 * Copy YAML files from src/clis/ to dist/clis/.
 */
const { readdirSync, copyFileSync, mkdirSync, existsSync, statSync } = require('fs');
const path = require('path');

function walk(src, dst) {
  if (!existsSync(src)) return;
  for (const f of readdirSync(src)) {
    const sp = path.join(src, f);
    const dp = path.join(dst, f);
    if (statSync(sp).isDirectory()) {
      walk(sp, dp);
    } else if (/\.ya?ml$/.test(f)) {
      mkdirSync(path.dirname(dp), { recursive: true });
      copyFileSync(sp, dp);
    }
  }
}

walk('src/clis', 'dist/clis');
