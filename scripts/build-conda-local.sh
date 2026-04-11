#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT_DIR}"

if ! command -v conda >/dev/null 2>&1; then
  echo "conda is required to build the local package."
  echo "Install Miniconda/Anaconda first, then rerun this helper."
  exit 1
fi

if ! conda build --help >/dev/null 2>&1; then
  echo "conda-build is not installed in the active conda base environment."
  echo "Run: conda install -n base -c conda-forge conda-build"
  exit 1
fi

cache_root="${BIOCLI_CONDA_CACHE_ROOT:-}"

if [ -z "${cache_root}" ]; then
  if [[ "${ROOT_DIR}" == /Volumes/* ]]; then
    temp_root="${TMPDIR:-/tmp}"
    temp_root="${temp_root%/}"
    cache_root="${temp_root}/biocli-conda"
  else
    cache_root="${ROOT_DIR}/.conda"
  fi
fi

mkdir -p "${cache_root}/pkgs" "${cache_root}/envs" "${cache_root}/conda-bld"

available_kb="$(df -Pk "${cache_root}" | awk 'NR==2 { print $4 }')"
recommended_kb=$((8 * 1024 * 1024))

if [ -n "${available_kb}" ] && [ "${available_kb}" -lt "${recommended_kb}" ]; then
  available_mb=$((available_kb / 1024))
  echo "Not enough free disk space for a safe local conda build."
  echo "Available: ${available_mb} MiB"
  echo "Recommended: at least 8192 MiB"
  echo "This helper uses ${cache_root} for package, environment, and build caches."
  echo "Set BIOCLI_CONDA_CACHE_ROOT to override the cache location."
  exit 1
fi

echo "Using local conda caches under ${cache_root}"
if [[ "${ROOT_DIR}" == /Volumes/* ]] && [[ -z "${BIOCLI_CONDA_CACHE_ROOT:-}" ]]; then
  echo "Repository is on /Volumes; using a temp-directory cache root to avoid AppleDouble corruption in conda environments."
fi

CONDA_PKGS_DIRS="${cache_root}/pkgs" \
CONDA_ENVS_PATH="${cache_root}/envs" \
CONDA_BLD_PATH="${cache_root}/conda-bld" \
conda build packaging/conda/recipe "$@"
