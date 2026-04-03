#!/bin/bash
# biocli core smoke tests — no network required
set -euo pipefail

echo "=== biocli smoke: core ==="

echo -n "  version... "
biocli --version > /dev/null
echo "OK"

echo -n "  list (json)... "
biocli list -f json | node -e "const d=JSON.parse(require('fs').readFileSync(0,'utf8')); if(!d.length) throw 'empty'" 2>/dev/null
echo "OK"

echo -n "  config path... "
biocli config path > /dev/null
echo "OK"

echo -n "  schema... "
biocli schema | node -e "const d=JSON.parse(require('fs').readFileSync(0,'utf8')); if(!d.title) throw 'bad'" 2>/dev/null
echo "OK"

echo -n "  schema meta... "
biocli schema meta | node -e "const d=JSON.parse(require('fs').readFileSync(0,'utf8')); if(!d.title) throw 'bad'" 2>/dev/null
echo "OK"

echo -n "  completion bash... "
biocli completion bash | head -1 > /dev/null
echo "OK"

echo ""
echo "All core smoke tests passed."
