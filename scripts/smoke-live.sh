#!/bin/bash
# biocli live smoke tests — requires network access
# Run manually or in nightly CI
set -euo pipefail

echo "=== biocli smoke: live API ==="

echo -n "  pubmed fetch... "
biocli pubmed fetch 36766853 -f json | node -e "const d=JSON.parse(require('fs').readFileSync(0,'utf8')); if(!d[0]?.pmid) throw 'bad'" 2>/dev/null
echo "OK"

echo -n "  gene search... "
biocli gene search TP53 -f json --limit 1 | node -e "const d=JSON.parse(require('fs').readFileSync(0,'utf8')); if(!d[0]?.symbol) throw 'bad'" 2>/dev/null
echo "OK"

echo -n "  uniprot fetch... "
biocli uniprot fetch P04637 -f json | node -e "const d=JSON.parse(require('fs').readFileSync(0,'utf8')); if(!d[0]?.accession) throw 'bad'" 2>/dev/null
echo "OK"

echo -n "  kegg pathway... "
biocli kegg pathway hsa04115 -f json | node -e "const d=JSON.parse(require('fs').readFileSync(0,'utf8')); if(!d[0]?.id) throw 'bad'" 2>/dev/null
echo "OK"

echo -n "  ensembl lookup... "
biocli ensembl lookup TP53 -f json | node -e "const d=JSON.parse(require('fs').readFileSync(0,'utf8')); if(!d[0]?.ensemblId) throw 'bad'" 2>/dev/null
echo "OK"

echo -n "  string partners... "
biocli string partners TP53 -f json --limit 1 | node -e "const d=JSON.parse(require('fs').readFileSync(0,'utf8')); if(!d[0]?.partnerA) throw 'bad'" 2>/dev/null
echo "OK"

echo -n "  doctor... "
biocli doctor -f json | node -e "const d=JSON.parse(require('fs').readFileSync(0,'utf8')); if(!d.checks) throw 'bad'" 2>/dev/null
echo "OK"

echo ""
echo "All live smoke tests passed."
