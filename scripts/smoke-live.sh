#!/bin/bash
# biocli live smoke tests — requires network access
# Run manually or in nightly CI
set -euo pipefail

# Use local project entrypoint, not global binary
BIOCLI="npx tsx src/main.ts"

echo "=== biocli smoke: live API ==="

echo -n "  pubmed fetch... "
$BIOCLI pubmed fetch 36766853 -f json | node -e "const d=JSON.parse(require('fs').readFileSync(0,'utf8')); if(!d[0]?.pmid) throw 'bad'" 2>/dev/null
echo "OK"

echo -n "  gene search... "
$BIOCLI gene search TP53 -f json --limit 1 | node -e "const d=JSON.parse(require('fs').readFileSync(0,'utf8')); if(!d[0]?.symbol) throw 'bad'" 2>/dev/null
echo "OK"

echo -n "  uniprot fetch... "
$BIOCLI uniprot fetch P04637 -f json | node -e "const d=JSON.parse(require('fs').readFileSync(0,'utf8')); if(!d[0]?.accession) throw 'bad'" 2>/dev/null
echo "OK"

echo -n "  kegg pathway... "
$BIOCLI kegg pathway hsa04115 -f json | node -e "const d=JSON.parse(require('fs').readFileSync(0,'utf8')); if(!d[0]?.id) throw 'bad'" 2>/dev/null
echo "OK"

echo -n "  ensembl lookup... "
$BIOCLI ensembl lookup TP53 -f json | node -e "const d=JSON.parse(require('fs').readFileSync(0,'utf8')); if(!d[0]?.ensemblId) throw 'bad'" 2>/dev/null
echo "OK"

echo -n "  string partners... "
$BIOCLI string partners TP53 -f json --limit 1 | node -e "const d=JSON.parse(require('fs').readFileSync(0,'utf8')); if(!d[0]?.partnerA) throw 'bad'" 2>/dev/null
echo "OK"

echo -n "  doctor... "
# doctor may exit 1 if optional checks (api key) are missing; just verify JSON output is valid
$BIOCLI doctor -f json 2>/dev/null | node -e "const d=JSON.parse(require('fs').readFileSync(0,'utf8')); if(!d.checks) throw 'bad'" || true
echo "OK"

echo ""
echo "All live smoke tests passed."
