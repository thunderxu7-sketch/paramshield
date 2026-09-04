#!/usr/bin/env bash
set -euo pipefail

CRE_BIN="${CRE_BIN:-$HOME/.cre/bin/cre}"

if [[ ! -x "$CRE_BIN" ]]; then
  echo "CRE CLI is not installed at $CRE_BIN" >&2
  exit 1
fi

"$CRE_BIN" version

if "$CRE_BIN" whoami >/dev/null 2>&1; then
  echo "CRE authentication: verified"
else
  echo "CRE authentication: pending"
fi
