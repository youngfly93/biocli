#!/bin/bash
# biocli core smoke tests — no network required
set -euo pipefail

# Use local project entrypoint, not global binary
BIOCLI="npx tsx src/main.ts"

echo "=== biocli smoke: core ==="

echo -n "  version... "
$BIOCLI --version > /dev/null
echo "OK"

echo -n "  list (json)... "
$BIOCLI list -f json | node -e "const d=JSON.parse(require('fs').readFileSync(0,'utf8')); if(!d.length) throw 'empty'" 2>/dev/null
echo "OK"

echo -n "  config path... "
$BIOCLI config path > /dev/null
echo "OK"

echo -n "  schema... "
$BIOCLI schema | node -e "const d=JSON.parse(require('fs').readFileSync(0,'utf8')); if(!d.title) throw 'bad'" 2>/dev/null
echo "OK"

echo -n "  schema meta... "
$BIOCLI schema meta | node -e "const d=JSON.parse(require('fs').readFileSync(0,'utf8')); if(!d.title) throw 'bad'" 2>/dev/null
echo "OK"

echo -n "  completion bash... "
$BIOCLI completion bash | head -1 > /dev/null
echo "OK"

echo ""
echo "All core smoke tests passed."
