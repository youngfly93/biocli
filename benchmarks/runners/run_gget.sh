#!/bin/bash
# Benchmark runner for gget (real execution)
# gget requires Ensembl IDs for info/seq; uses gene symbols for enrichr/search
set -euo pipefail

DATE=$(date +%Y-%m-%d)
OUTDIR="benchmarks/results/${DATE}/raw/gget"
mkdir -p "$OUTDIR"

echo "=== gget benchmark: ${DATE} ==="
echo "Version: $(gget --version 2>&1 | head -1)"
echo ""

run_task() {
  local id="$1"
  shift
  local outfile="${OUTDIR}/${id}.json"
  local errfile="${OUTDIR}/${id}.stderr"
  local start=$(python3 -c 'import time; print(int(time.time()*1000))')

  echo -n "  ${id}... "
  if eval "$@" > "$outfile" 2>"$errfile"; then
    local end=$(python3 -c 'import time; print(int(time.time()*1000))')
    local ms=$(( end - start ))
    echo "OK (${ms}ms)"
  else
    local end=$(python3 -c 'import time; print(int(time.time()*1000))')
    local ms=$(( end - start ))
    echo "FAIL (${ms}ms)"
  fi
}

# ── Gene Tasks ───────────────────────────────────────────────────────────────
echo "Gene tasks:"
# gene-01: gget info needs Ensembl ID (ENSG00000141510 = TP53)
# gget has no cross-database dossier — only Ensembl metadata
run_task gene-01 'gget info ENSG00000141510 -j'

# gene-02: gget enrichr needs -db flag
run_task gene-02 'gget enrichr TP53 BRCA1 EGFR MYC CDK2 -db pathway -j'

# gene-03: gget seq needs Ensembl ID
run_task gene-03 'gget seq ENSG00000141510'

# ── Variant Tasks ────────────────────────────────────────────────────────────
echo "Variant tasks:"
# gget has no variant commands
run_task variant-01 'echo "{\"status\":\"not_supported\",\"reason\":\"gget has no variant dossier\"}"'
run_task variant-02 'echo "{\"status\":\"not_supported\",\"reason\":\"gget has no variant interpretation\"}"'
run_task variant-03 'echo "{\"status\":\"not_supported\",\"reason\":\"gget has no SNP lookup\"}"'

# ── Literature Tasks ─────────────────────────────────────────────────────────
echo "Literature tasks:"
# gget has no PubMed/literature commands
run_task lit-01 'echo "{\"status\":\"not_supported\",\"reason\":\"gget has no literature search\"}"'
run_task lit-02 'echo "{\"status\":\"not_supported\",\"reason\":\"gget has no PubMed fetch\"}"'
run_task lit-03 'echo "{\"status\":\"not_supported\",\"reason\":\"gget has no batch PubMed\"}"'

# ── Data Preparation Tasks ───────────────────────────────────────────────────
echo "Data preparation tasks:"
# gget has no dataset discovery or workflow preparation
run_task data-01 'echo "{\"status\":\"not_supported\",\"reason\":\"gget has no dataset scout\"}"'
run_task data-02 'echo "{\"status\":\"not_supported\",\"reason\":\"gget has no workflow prepare\"}"'
run_task data-03 'echo "{\"status\":\"not_supported\",\"reason\":\"gget has no GEO download\"}"'

echo ""
echo "Results saved to: ${OUTDIR}/"
echo "Done."
