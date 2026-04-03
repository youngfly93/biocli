#!/bin/bash
# Benchmark runner for BioMCP
# Executes equivalent tasks where possible
set -euo pipefail

DATE=$(date +%Y-%m-%d)
OUTDIR="benchmarks/results/${DATE}/raw/biomcp"
mkdir -p "$OUTDIR"

echo "=== BioMCP benchmark: ${DATE} ==="
echo "Version: $(biomcp --version 2>&1 || echo 'not installed')"
echo ""

run_task() {
  local id="$1"
  shift
  local outfile="${OUTDIR}/${id}.json"
  local errfile="${OUTDIR}/${id}.stderr"
  local start=$(date +%s%N)

  echo -n "  ${id}... "
  if "$@" > "$outfile" 2>"$errfile"; then
    local end=$(date +%s%N)
    local ms=$(( (end - start) / 1000000 ))
    echo "OK (${ms}ms)"
  else
    local end=$(date +%s%N)
    local ms=$(( (end - start) / 1000000 ))
    echo "FAIL (${ms}ms)"
  fi
}

# ── Gene Tasks ───────────────────────────────────────────────────────────────
echo "Gene tasks:"
# gene-01: biomcp gene get covers multiple sources
run_task gene-01 biomcp gene get TP53
# gene-02: biomcp has pathway enrich
run_task gene-02 biomcp pathway enrich TP53 BRCA1 EGFR MYC CDK2
# gene-03: biomcp does not download FASTA sequences
run_task gene-03 bash -c 'echo "{\"status\": \"not_supported\", \"reason\": \"BioMCP has no sequence download command\"}"'

# ── Variant Tasks ────────────────────────────────────────────────────────────
echo "Variant tasks:"
# variant-01: biomcp variant get
run_task variant-01 biomcp variant get rs429358
# variant-02: biomcp variant get (no separate interpret)
run_task variant-02 biomcp variant get rs334
# variant-03: biomcp variant search
run_task variant-03 biomcp variant search rs7412

# ── Literature Tasks ─────────────────────────────────────────────────────────
echo "Literature tasks:"
# lit-01: biomcp article search
run_task lit-01 biomcp article search "TP53 apoptosis" --max-results 5
# lit-02: biomcp article get by PMID
run_task lit-02 biomcp article get 36766853
# lit-03: batch — biomcp may not support multi-PMID in one call
run_task lit-03 bash -c 'biomcp article get 36766853 && biomcp article get 35022513 && biomcp article get 34234131'

# ── Data Preparation Tasks ───────────────────────────────────────────────────
echo "Data preparation tasks:"
# data-01: no dataset scout
run_task data-01 bash -c 'echo "{\"status\": \"not_supported\", \"reason\": \"BioMCP has no dataset discovery/scout command\"}"'
# data-02: no workflow prepare
run_task data-02 bash -c 'echo "{\"status\": \"not_supported\", \"reason\": \"BioMCP has no workflow-prepare command\"}"'
# data-03: no GEO download
run_task data-03 bash -c 'echo "{\"status\": \"not_supported\", \"reason\": \"BioMCP has no GEO/SRA download command\"}"'

echo ""
echo "Results saved to: ${OUTDIR}/"
echo "Done."
