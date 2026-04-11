#!/usr/bin/env bash
set -euo pipefail

export npm_config_cache="${SRC_DIR}/.npm-cache"
export npm_config_update_notifier=false
export npm_config_audit=false
export npm_config_fund=false

npm install --ignore-scripts
npm run build
npm prune --omit=dev

install_root="${PREFIX}/lib/node_modules/@yangfei_93sky/biocli"
mkdir -p "${install_root}" "${PREFIX}/bin"

cp -R dist "${install_root}/dist"
cp -R node_modules "${install_root}/node_modules"
cp package.json "${install_root}/package.json"
cp README.md "${install_root}/README.md"
cp LICENSE "${install_root}/LICENSE"

chmod +x "${install_root}/dist/main.js"
ln -sf "${install_root}/dist/main.js" "${PREFIX}/bin/biocli"
ln -sf "${install_root}/dist/main.js" "${PREFIX}/bin/ncbicli"
