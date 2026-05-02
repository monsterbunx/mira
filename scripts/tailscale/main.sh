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

# HTTP server simple en :41642 que expone tailscale status --json + ping helpers
cat > /tmp/server.py <<'PY'
import json, subprocess, http.server, socketserver, urllib.parse
TIMEOUT_PING = 4
TIMEOUT_PING_ALL = 30
class H(http.server.BaseHTTPRequestHandler):
    def log_message(self, fmt, *a): return
    def _json(self, code, body):
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(body if isinstance(body, bytes) else json.dumps(body).encode())
    def _ping(self, peer):
        # tailscale ping --c=1 --timeout=3s <peer>; salida tipo "pong from <name> (100.x.x.x) via <relay/direct> in 12ms"
        try:
            r = subprocess.run(
                ["tailscale", "ping", "--c", "1", "--timeout", "3s", peer],
                capture_output=True, timeout=TIMEOUT_PING,
            )
            return {"peer": peer, "ok": r.returncode == 0, "out": r.stdout.decode(errors="ignore").strip(),
                    "err": r.stderr.decode(errors="ignore").strip()}
        except subprocess.TimeoutExpired:
            return {"peer": peer, "ok": False, "out": "", "err": "timeout"}
        except Exception as e:
            return {"peer": peer, "ok": False, "out": "", "err": str(e)}
    def do_GET(self):
        path, _, qs = self.path.partition("?")
        params = urllib.parse.parse_qs(qs)
        if path == "/health":
            up = subprocess.run(["tailscale", "status", "--json"], capture_output=True).returncode == 0
            return self._json(200, {"ok": True, "tailscale": "up" if up else "down"})
        if path == "/status":
            r = subprocess.run(["tailscale", "status", "--json"], capture_output=True)
            if r.returncode != 0:
                return self._json(503, {"error": "tailscale not ready", "stderr": r.stderr.decode(errors="ignore")})
            return self._json(200, r.stdout)
        if path == "/ping":
            peer = (params.get("peer") or [None])[0]
            if not peer:
                return self._json(400, {"error": "peer query param required"})
            return self._json(200, self._ping(peer))
        if path == "/ping/all":
            # Pingea cada peer online en paralelo; respeta TIMEOUT_PING_ALL global
            r = subprocess.run(["tailscale", "status", "--json"], capture_output=True)
            if r.returncode != 0:
                return self._json(503, {"error": "tailscale not ready"})
            try:
                data = json.loads(r.stdout)
            except Exception as e:
                return self._json(500, {"error": f"parse: {e}"})
            peers = list((data.get("Peer") or {}).values())
            online_ips = [p["TailscaleIPs"][0] for p in peers
                          if p.get("Online") and p.get("TailscaleIPs")]
            from concurrent.futures import ThreadPoolExecutor
            with ThreadPoolExecutor(max_workers=8) as ex:
                results = list(ex.map(self._ping, online_ips))
            return self._json(200, {"count": len(results), "results": results})
        return self._json(404, {"error": "not found"})

class T(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True

print("[mira/tailscale] HTTP /status /ping /ping/all on :41642", flush=True)
T(("0.0.0.0", 41642), H).serve_forever()
PY

exec python3 /tmp/server.py
