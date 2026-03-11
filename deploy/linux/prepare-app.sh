#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"

echo "Repository root: ${REPO_ROOT}"

pushd "${REPO_ROOT}/frontend" >/dev/null
npm ci
npm run build
popd >/dev/null

pushd "${REPO_ROOT}/backend" >/dev/null
npm ci
npm run build
popd >/dev/null

echo "Frontend and backend build completed."
