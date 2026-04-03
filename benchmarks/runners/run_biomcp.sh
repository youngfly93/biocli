#!/bin/bash
# Benchmark runner for BioMCP (real execution)
set -euo pipefail

DATE=$(date +%Y-%m-%d)
OUTDIR="benchmarks/results/${DATE}/raw/biomcp"
mkdir -p "$OUTDIR"

echo "=== BioMCP benchmark: ${DATE} ==="
echo "Version: $(biomcp --version 2>&1 | head -1 || echo 'unknown')"
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
# gene-01: biomcp gene get provides multi-source gene info
run_task gene-01 'biomcp get gene TP53 -j'

# gene-02: biomcp pathway search (no multi-gene enrichment — search by keyword)
run_task gene-02 'biomcp search pathway "TP53 BRCA1 EGFR apoptosis" -j'

# gene-03: biomcp has no FASTA sequence download
run_task gene-03 'echo "{\"status\":\"not_supported\",\"reason\":\"BioMCP has no sequence download\"}"'

# ── Variant Tasks ────────────────────────────────────────────────────────────
echo "Variant tasks:"
# variant-01: biomcp get variant
run_task variant-01 'biomcp get variant rs429358 -j'

# variant-02: biomcp get variant for rs334
run_task variant-02 'biomcp get variant rs334 -j'

# variant-03: biomcp search variant
run_task variant-03 'biomcp search variant -g APOE -j'

# ── Literature Tasks ─────────────────────────────────────────────────────────
echo "Literature tasks:"
# lit-01: biomcp search article
run_task lit-01 'biomcp search article "TP53 apoptosis" -l 5 -j'

# lit-02: biomcp get article
run_task lit-02 'biomcp get article 36766853 -j'

# lit-03: biomcp article batch
run_task lit-03 'biomcp article batch 36766853 35022513 34234131 -j'

# ── Data Preparation Tasks ───────────────────────────────────────────────────
echo "Data preparation tasks:"
# BioMCP has no dataset discovery or workflow preparation
run_task data-01 'echo "{\"status\":\"not_supported\",\"reason\":\"BioMCP has no dataset scout\"}"'
run_task data-02 'echo "{\"status\":\"not_supported\",\"reason\":\"BioMCP has no workflow prepare\"}"'
run_task data-03 'echo "{\"status\":\"not_supported\",\"reason\":\"BioMCP has no GEO/SRA download\"}"'

echo ""
echo "Results saved to: ${OUTDIR}/"
echo "Done."
