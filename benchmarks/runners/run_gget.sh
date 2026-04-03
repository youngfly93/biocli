#!/bin/bash
# Benchmark runner for gget
# Executes equivalent tasks where possible
set -euo pipefail

DATE=$(date +%Y-%m-%d)
OUTDIR="benchmarks/results/${DATE}/raw/gget"
mkdir -p "$OUTDIR"

echo "=== gget benchmark: ${DATE} ==="
echo "Version: $(gget --version 2>&1 || echo 'not installed')"
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
# gene-01: gget has info but no cross-database dossier
run_task gene-01 gget info TP53 --json
# gene-02: gget has enrichr module
run_task gene-02 gget enrichr -g TP53 BRCA1 EGFR MYC CDK2 --json
# gene-03: gget has seq module
run_task gene-03 gget seq --gene TP53 --json

# ── Variant Tasks ────────────────────────────────────────────────────────────
echo "Variant tasks:"
# variant-01: gget does not have a variant dossier — try gget info
run_task variant-01 bash -c 'echo "{\"status\": \"not_supported\", \"reason\": \"gget has no variant dossier command\"}"'
# variant-02: no variant interpret
run_task variant-02 bash -c 'echo "{\"status\": \"not_supported\", \"reason\": \"gget has no variant-interpret command\"}"'
# variant-03: no SNP lookup
run_task variant-03 bash -c 'echo "{\"status\": \"not_supported\", \"reason\": \"gget has no SNP lookup command\"}"'

# ── Literature Tasks ─────────────────────────────────────────────────────────
echo "Literature tasks:"
# lit-01: gget does not have a literature brief
run_task lit-01 bash -c 'echo "{\"status\": \"not_supported\", \"reason\": \"gget has no literature search command\"}"'
# lit-02: no PubMed fetch
run_task lit-02 bash -c 'echo "{\"status\": \"not_supported\", \"reason\": \"gget has no PubMed fetch command\"}"'
# lit-03: no batch PubMed
run_task lit-03 bash -c 'echo "{\"status\": \"not_supported\", \"reason\": \"gget has no PubMed batch fetch command\"}"'

# ── Data Preparation Tasks ───────────────────────────────────────────────────
echo "Data preparation tasks:"
# data-01: no dataset scout
run_task data-01 bash -c 'echo "{\"status\": \"not_supported\", \"reason\": \"gget has no dataset discovery command\"}"'
# data-02: no workflow prepare
run_task data-02 bash -c 'echo "{\"status\": \"not_supported\", \"reason\": \"gget has no workflow-prepare command\"}"'
# data-03: no GEO download
run_task data-03 bash -c 'echo "{\"status\": \"not_supported\", \"reason\": \"gget has no GEO download command\"}"'

echo ""
echo "Results saved to: ${OUTDIR}/"
echo "Done."
