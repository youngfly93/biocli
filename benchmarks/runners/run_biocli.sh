#!/bin/bash
# Benchmark runner for biocli
# Executes all 12 tasks and saves raw output
set -euo pipefail

DATE=$(date +%Y-%m-%d)
OUTDIR="benchmarks/results/${DATE}/raw/biocli"
mkdir -p "$OUTDIR"

BIOCLI="npx tsx src/main.ts"

echo "=== biocli benchmark: ${DATE} ==="
echo "Version: $($BIOCLI --version)"
echo ""

run_task() {
  local id="$1"
  shift
  local outfile="${OUTDIR}/${id}.json"
  local errfile="${OUTDIR}/${id}.stderr"
  local start=$(python3 -c 'import time; print(int(time.time()*1000))')

  echo -n "  ${id}... "
  if "$@" > "$outfile" 2>"$errfile"; then
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
run_task gene-01 $BIOCLI aggregate gene-dossier TP53 -f json
run_task gene-02 $BIOCLI aggregate enrichment TP53,BRCA1,EGFR,MYC,CDK2 -f json
run_task gene-03 $BIOCLI gene fetch 7157 --type protein -f json

# ── Variant Tasks ────────────────────────────────────────────────────────────
echo "Variant tasks:"
run_task variant-01 $BIOCLI aggregate variant-dossier rs429358 -f json
run_task variant-02 $BIOCLI aggregate variant-interpret rs334 -f json
run_task variant-03 $BIOCLI snp lookup rs7412 -f json

# ── Literature Tasks ─────────────────────────────────────────────────────────
echo "Literature tasks:"
run_task lit-01 $BIOCLI aggregate literature-brief "TP53 apoptosis" --limit 5 -f json
run_task lit-02 $BIOCLI pubmed fetch 36766853 -f json
run_task lit-03 $BIOCLI pubmed fetch 36766853,35022513,34234131 -f json

# ── Data Preparation Tasks ───────────────────────────────────────────────────
echo "Data preparation tasks:"
run_task data-01 $BIOCLI aggregate workflow-scout "TP53 breast cancer RNA-seq" --gene TP53 --limit 5 -f json
run_task data-02 $BIOCLI aggregate workflow-prepare GSE315149 --gene TP53 --outdir /tmp/biocli-bench-prepare --plan -f json
run_task data-03 $BIOCLI geo download GSE12345 --dry-run -f json

echo ""
echo "Results saved to: ${OUTDIR}/"
echo "Done."
