import { useEffect, useState } from "react";

type Device = {
  id: string;
  name: string;
  os: string | null;
  ipv4: string | null;
  tailnetIp: string | null;
  online: boolean;
  firstSeen: string;
  lastSeen: string;
};

type EventRow = {
  id: number;
  at: string;
  kind: string;
};

type Snapshot = {
  id: number;
  takenAt: string;
  online: boolean;
  rxBytes: string | null;
  txBytes: string | null;
};

type History = {
  device: Device;
  events: EventRow[];
  snapshots: Snapshot[];
};

function osIcon(os: string | null) {
  if (!os) return "💻";
  const s = os.toLowerCase();
  if (s.includes("linux")) return "🐧";
  if (s.includes("macos") || s.includes("darwin")) return "🍎";
  if (s.includes("windows")) return "🪟";
  if (s.includes("ios")) return "📱";
  if (s.includes("android")) return "🤖";
  return "💻";
}

function fmtFull(iso: string) {
  return new Date(iso).toLocaleString("es", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function eventLabel(kind: string) {
  if (kind === "online") return "🟢 vino online";
  if (kind === "offline") return "🔴 se fue offline";
  if (kind === "first_seen") return "🆕 primera vez visto";
  return kind;
}

export default function DeviceDetail({ id, onClose }: { id: string; onClose: () => void }) {
  const [data, setData] = useState<History | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancel = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/devices/${encodeURIComponent(id)}/history`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const j = (await res.json()) as History;
        if (!cancel) setData(j);
      } catch (e) {
        if (!cancel) setError(String(e));
      } finally {
        if (!cancel) setLoading(false);
      }
    }
    load();
    const t = setInterval(load, 15000);
    return () => {
      cancel = true;
      clearInterval(t);
    };
  }, [id]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="drawer-root" role="dialog" aria-modal="true" aria-label="detalle de device">
      <div className="drawer-backdrop" onClick={onClose} />
      <aside className="drawer">
        <header className="drawer-head">
          <button className="drawer-close" onClick={onClose} aria-label="cerrar">
            ✕
          </button>
          {data ? (
            <>
              <div className="drawer-title">
                <span className="card-icon">{osIcon(data.device.os)}</span>
                <div>
                  <strong>{data.device.name}</strong>
                  <small className="card-os">
                    {data.device.os ?? "—"} · <code>{data.device.tailnetIp ?? "—"}</code>
                  </small>
                </div>
                <span className={`dot dot-${data.device.online ? "on" : "off"}`} />
              </div>
              <div className="drawer-meta">
                <div>
                  <span>first seen</span>
                  <code>{fmtFull(data.device.firstSeen)}</code>
                </div>
                <div>
                  <span>last seen</span>
                  <code>{fmtFull(data.device.lastSeen)}</code>
                </div>
              </div>
            </>
          ) : (
            <div className="drawer-title">
              <strong>{loading ? "cargando…" : "—"}</strong>
            </div>
          )}
        </header>

        {error && <div className="error">{error}</div>}

        {data && (
          <section>
            <h3>eventos ({data.events.length})</h3>
            {data.events.length === 0 ? (
              <p className="empty">sin eventos en las últimas 24h.</p>
            ) : (
              <ul className="events">
                {[...data.events].reverse().map((e) => (
                  <li key={e.id}>
                    <span className="ev-kind">{eventLabel(e.kind)}</span>
                    <code className="ev-time">{fmtFull(e.at)}</code>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}
      </aside>
    </div>
  );
}
