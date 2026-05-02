#!/bin/bash
# mira/vite — debian:12 + Bun (vía jhin/bun) + Vite dev server.
set -e

export DEBIAN_FRONTEND=noninteractive

if ! command -v curl >/dev/null 2>&1; then
  apt-get update -qq
  apt-get install -y --no-install-recommends curl ca-certificates unzip
fi

if [ ! -x "$HOME/.bun/bin/bun" ]; then
  echo "[mira/vite] sourcing jhin/bun"
  . <(curl -fsSL https://monsterbunx.github.io/jhin/bun) es
fi
export PATH="$HOME/.bun/bin:$PATH"

cd /app
echo "[mira/vite] bun install"
bun install --frozen-lockfile 2>/dev/null || bun install

echo "[mira/vite] starting vite dev server"
exec bun run dev
