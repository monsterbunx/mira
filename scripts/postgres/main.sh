#!/bin/bash
# mira/postgres — debian:12 + postgresql vía apt + setup idempotente + run en foreground.
set -e

export DEBIAN_FRONTEND=noninteractive

if ! command -v psql >/dev/null 2>&1; then
  echo "[mira/postgres] apt update + install postgresql"
  apt-get update -qq
  echo 'exit 101' > /usr/sbin/policy-rc.d
  chmod +x /usr/sbin/policy-rc.d
  apt-get install -y --no-install-recommends postgresql
  rm /usr/sbin/policy-rc.d
fi

PG_VERSION=$(ls /etc/postgresql/ 2>/dev/null | head -n1)
[ -z "$PG_VERSION" ] && { echo "[mira/postgres] no postgresql version detected"; exit 1; }
PG_DATA="/var/lib/postgresql/$PG_VERSION/main"
PG_CONF_DIR="/etc/postgresql/$PG_VERSION/main"
PG_BIN="/usr/lib/postgresql/$PG_VERSION/bin"

echo "[mira/postgres] PostgreSQL $PG_VERSION at $PG_DATA"

sed -i "s/^#\?listen_addresses\s*=.*/listen_addresses = '*'/" "$PG_CONF_DIR/postgresql.conf"
grep -q "host all all 0.0.0.0/0 md5" "$PG_CONF_DIR/pg_hba.conf" || \
  echo "host all all 0.0.0.0/0 md5" >> "$PG_CONF_DIR/pg_hba.conf"

chown -R postgres:postgres /var/lib/postgresql /etc/postgresql /var/log/postgresql /var/run/postgresql 2>/dev/null || true

echo "[mira/postgres] starting tmp cluster for setup"
pg_ctlcluster "$PG_VERSION" main start

su postgres -c "psql -tc \"SELECT 1 FROM pg_roles WHERE rolname='mira'\"" | grep -q 1 || \
  su postgres -c "psql -c \"CREATE USER mira WITH PASSWORD 'mira_dev'\""
su postgres -c "psql -tc \"SELECT 1 FROM pg_database WHERE datname='mira'\"" | grep -q 1 || \
  su postgres -c "psql -c \"CREATE DATABASE mira OWNER mira\""

echo "[mira/postgres] stopping tmp cluster, exec foreground"
pg_ctlcluster "$PG_VERSION" main stop

exec su postgres -c "$PG_BIN/postgres -D $PG_DATA -c config_file=$PG_CONF_DIR/postgresql.conf -c hba_file=$PG_CONF_DIR/pg_hba.conf -c ident_file=$PG_CONF_DIR/pg_ident.conf"
