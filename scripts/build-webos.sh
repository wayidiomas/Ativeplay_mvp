#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd -- "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DIST_DIR="${ROOT_DIR}/dist"
WEBOS_DIR="${ROOT_DIR}/webos"

echo "==> Build web (Vite)"
npm run build

echo "==> Copiando manifestos e ícones webOS"
mkdir -p "${DIST_DIR}"
cp "${WEBOS_DIR}/appinfo.json" "${DIST_DIR}/"
cp "${WEBOS_DIR}/icon.png" "${DIST_DIR}/"
cp "${WEBOS_DIR}/largeIcon.png" "${DIST_DIR}/"
cp "${WEBOS_DIR}/splash.png" "${DIST_DIR}/"

echo "==> Empacotando (.ipk)"
cd "${DIST_DIR}"
if command -v ares-package >/dev/null 2>&1; then
  # --no-minify evita falhas do minificador do ares em bundles ES2015+ (já minificamos no Vite)
  ares-package --no-minify .
  echo "Pacote gerado:"
  ls -1t *.ipk | head -n1
else
  echo "⚠️  ares-package não encontrado. Instale @webos-tools/cli (npm i -g @webos-tools/cli) e reexecute." >&2
fi
