#!/bin/bash
# mira/bun — debian:12 + Bun (vía jhin/bun) + Prisma db push + server con poller de tailscale.
set -e

export DEBIAN_FRONTEND=noninteractive

if ! command -v curl >/dev/null 2>&1; then
  apt-get update -qq
  apt-get install -y --no-install-recommends curl ca-certificates unzip
fi

if [ ! -x "$HOME/.bun/bin/bun" ]; then
  echo "[mira/bun] sourcing jhin/bun"
  . <(curl -fsSL https://monsterbunx.github.io/jhin/bun) es
fi
export PATH="$HOME/.bun/bin:$PATH"

cd /app
echo "[mira/bun] bun install"
bun install --frozen-lockfile 2>/dev/null || bun install

echo "[mira/bun] prisma generate"
bunx prisma generate

echo "[mira/bun] waiting for postgres + prisma db push"
i=0
until bunx prisma db push --skip-generate --accept-data-loss; do
  i=$((i+1))
  [ $i -ge 30 ] && { echo "[mira/bun] db push failed after 30 tries"; exit 1; }
  echo "[mira/bun] db not ready, retry $i/30..."
  sleep 2
done

echo "[mira/bun] starting server"
exec bun run --watch server.ts
