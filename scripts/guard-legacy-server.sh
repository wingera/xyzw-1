#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

echo "[guard] checking deploy/runtime entrypoints do not start legacy Flask..."
if rg -n "(python\\s+server/app\\.py|flask\\s+run|gunicorn\\s+.*server\\.app|uwsgi\\s+.*server\\.app)" \
  package.json start-dev.sh scripts/start-24x7.sh docker/dockerfile >/dev/null 2>&1; then
  echo "[guard] found legacy Flask start command in deployment/runtime entrypoints."
  exit 1
fi

echo "[guard] checking proxy configs do not target legacy Flask ports..."
if rg -n "proxy_pass\\s+http://[^;]*(:5000|server/app|legacy)" \
  docker/nginx.conf deploy/nginx/xyzw-xq5007.conf >/dev/null 2>&1; then
  echo "[guard] nginx proxy config must not forward to legacy Flask."
  exit 1
fi

echo "[guard] checking shared deploy docs do not recommend enabling legacy Flask..."
if rg -n "ENABLE_LEGACY_FLASK=1|ALLOW_LEGACY_FLASK_PUBLIC_BIND=1|ENABLE_LEGACY_FILE_TOKEN_ROUTE=1" \
  docs/startup.md docs/tunnel-production-baseline.md deploy docker >/dev/null 2>&1; then
  echo "[guard] shared deploy/docs must not recommend enabling legacy Flask."
  exit 1
fi

echo "[guard] checking docker build context excludes legacy server..."
if ! grep -qx "server/" .dockerignore; then
  echo "[guard] .dockerignore must exclude server/ from docker build context."
  exit 1
fi

if rg -n "(COPY|ADD)\\s+.*server/" docker/dockerfile >/dev/null 2>&1; then
  echo "[guard] docker/dockerfile must not copy legacy server artifacts."
  exit 1
fi

echo "[guard] checking dist/ does not include legacy server files..."
if [[ -d dist ]] && find dist -type f | rg -n "(^|/)server/" >/dev/null 2>&1; then
  echo "[guard] dist/ unexpectedly contains legacy server artifacts."
  exit 1
fi

check_archive_for_sensitive_payload() {
  local archive="$1"
  if tar -tf "$archive" | rg -n \
    "^backend/\\.env$|^backend/data/|^backend/node_modules/|^backend/test/|^backend/.*\\.sqlite(\\.bin)?$|^backend/.*backups/" \
    >/dev/null 2>&1; then
    echo "[guard] archive contains sensitive backend payloads: $archive"
    exit 1
  fi
}

if [[ $# -gt 0 ]]; then
  for archive in "$@"; do
    if [[ ! -f "$archive" ]]; then
      echo "[guard] skip missing archive: $archive"
      continue
    fi
    echo "[guard] checking archive: $archive"
    if tar -tf "$archive" | rg -n "^server/" >/dev/null 2>&1; then
      echo "[guard] archive contains legacy server artifacts: $archive"
      exit 1
    fi
    check_archive_for_sensitive_payload "$archive"
  done
else
  if [[ -f dist.tar.gz ]] && tar -tf dist.tar.gz | rg -n "^server/" >/dev/null 2>&1; then
    echo "[guard] dist.tar.gz contains legacy server artifacts."
    exit 1
  fi
  if [[ -f dist.tar.gz ]]; then
    check_archive_for_sensitive_payload dist.tar.gz
  fi
fi

echo "[guard] legacy Flask exclusion checks passed."
