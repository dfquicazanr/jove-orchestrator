#!/usr/bin/env bash
# Run backend tests with the project venv (same deps as CI: pip install -e ".[dev]").
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

PYTHON="${PYTHON:-python3}"
VENV="$ROOT/.venv"

if [[ ! -x "$VENV/bin/python" ]]; then
  echo "Creating virtualenv at $VENV ..."
  if ! command -v "$PYTHON" >/dev/null 2>&1; then
    echo "error: $PYTHON not found. Install Python 3.12+ or set PYTHON=..." >&2
    exit 127
  fi
  "$PYTHON" -m venv "$VENV"
  "$VENV/bin/pip" install -U pip
  "$VENV/bin/pip" install -e ".[dev]"
fi

exec "$VENV/bin/python" -m pytest "$@"
