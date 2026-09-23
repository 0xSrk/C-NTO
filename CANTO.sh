#!/usr/bin/env bash
# CΛNTO — lanceur Lab (macOS et Linux, double-clic ou terminal)
set -euo pipefail
cd "$(dirname "$0")"

echo
echo "  === CΛNTO · lanceur ==="
echo

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js ≥ 22.12 est requis — https://nodejs.org"
  exit 1
fi

if [[ ! -d node_modules ]]; then
  echo "Première installation des dépendances…"
  npm install --legacy-peer-deps
fi

exec npm run launch
