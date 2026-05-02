#!/bin/bash
# mira/tailscale — debian:12 + tailscale (vía jhin/tailscale) + tailscaled userspace + HTTP server con tailscale status --json.
set -e

export DEBIAN_FRONTEND=noninteractive

if ! command -v curl >/dev/null 2>&1; then
  apt-get update -qq
  apt-get install -y --no-install-recommends curl ca-certificates iproute2 procps
fi

if ! command -v tailscale >/dev/null 2>&1; then
  echo "[mira/tailscale] sourcing jhin/tailscale"
  . <(curl -fsSL https://monsterbunx.github.io/jhin/tailscale) es
fi

if ! command -v python3 >/dev/null 2>&1; then
  apt-get install -y --no-install-recommends python3
fi

mkdir -p /var/run/tailscale /var/lib/tailscale

# Arranca tailscaled en userspace networking (no requiere TUN cuando solo lees status)
if ! pgrep -x tailscaled >/dev/null 2>&1; then
  echo "[mira/tailscale] launching tailscaled (userspace)"
  nohup tailscaled \
    --tun=userspace-networking \
    --state=/var/lib/tailscale/tailscaled.state \
    --socket=/var/run/tailscale/tailscaled.sock \
    > /var/log/tailscaled.log 2>&1 &

  # Espera a que el socket esté listo
  for _ in $(seq 1 30); do [ -S /var/run/tailscale/tailscaled.sock ] && break; sleep 1; done
fi

# Conectar al tailnet si aún no
TS_BACKEND_STATE="$(tailscale status --json 2>/dev/null | grep -o '"BackendState":"[^"]*"' | head -n1 | cut -d'"' -f4)"
if [ "$TS_BACKEND_STATE" != "Running" ]; then
  if [ -n "$TS_AUTHKEY" ]; then
    echo "[mira/tailscale] tailscale up with TS_AUTHKEY"
    tailscale up --authkey="$TS_AUTHKEY" --hostname="mira-tailscale" --accept-routes=false || true
  else
    echo "[mira/tailscale] no TS_AUTHKEY set — running 'tailscale up' (URL aparecerá abajo, autoriza desde el navegador)"
    tailscale up --hostname="mira-tailscale" --accept-routes=false &
  fi
fi

# HTTP server simple en :41642 que expone tailscale status --json
cat > /tmp/server.py <<'PY'
import json, subprocess, http.server, socketserver
class H(http.server.BaseHTTPRequestHandler):
    def log_message(self, fmt, *a): return
    def _json(self, code, body):
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(body if isinstance(body, bytes) else json.dumps(body).encode())
    def do_GET(self):
        if self.path == "/health":
            up = subprocess.run(["tailscale", "status", "--json"], capture_output=True).returncode == 0
            return self._json(200, {"ok": True, "tailscale": "up" if up else "down"})
        if self.path == "/status":
            r = subprocess.run(["tailscale", "status", "--json"], capture_output=True)
            if r.returncode != 0:
                return self._json(503, {"error": "tailscale not ready", "stderr": r.stderr.decode(errors="ignore")})
            return self._json(200, r.stdout)
        return self._json(404, {"error": "not found"})

class T(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True

print("[mira/tailscale] HTTP /status on :41642", flush=True)
T(("0.0.0.0", 41642), H).serve_forever()
PY

exec python3 /tmp/server.py
