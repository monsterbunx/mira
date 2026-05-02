import { useEffect, useMemo, useState } from "react";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from "recharts";

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

const WINDOW_MS = 24 * 3600 * 1000;

type Segment = { start: number; end: number; online: boolean };

function buildSegments(snapshots: Snapshot[], now: number): Segment[] {
  const windowStart = now - WINDOW_MS;
  const inWindow = snapshots.filter((s) => new Date(s.takenAt).getTime() >= windowStart);
  if (inWindow.length === 0) return [];

  const raw: Segment[] = inWindow.map((s, i) => {
    const start = new Date(s.takenAt).getTime();
    const end = i + 1 < inWindow.length ? new Date(inWindow[i + 1].takenAt).getTime() : now;
    return { start, end, online: s.online };
  });

  const merged: Segment[] = [];
  for (const s of raw) {
    const last = merged[merged.length - 1];
    if (last && last.online === s.online) last.end = s.end;
    else merged.push({ ...s });
  }
  return merged;
}

function fmtBytesPerSec(bps: number): string {
  if (bps < 1024) return `${bps.toFixed(0)} B/s`;
  if (bps < 1024 ** 2) return `${(bps / 1024).toFixed(1)} KB/s`;
  if (bps < 1024 ** 3) return `${(bps / 1024 ** 2).toFixed(2)} MB/s`;
  return `${(bps / 1024 ** 3).toFixed(2)} GB/s`;
}

function fmtTimeShort(iso: string) {
  return new Date(iso).toLocaleTimeString("es", { hour: "2-digit", minute: "2-digit" });
}

type TrafficPoint = { bucket: string; rx: number; tx: number };

function buildTraffic(snapshots: Snapshot[]): TrafficPoint[] {
  const points: TrafficPoint[] = [];
  for (let i = 1; i < snapshots.length; i++) {
    const a = snapshots[i - 1];
    const b = snapshots[i];
    const dt = (new Date(b.takenAt).getTime() - new Date(a.takenAt).getTime()) / 1000;
    if (dt <= 0) continue;
    const dRx = Math.max(0, Number(b.rxBytes ?? 0) - Number(a.rxBytes ?? 0));
    const dTx = Math.max(0, Number(b.txBytes ?? 0) - Number(a.txBytes ?? 0));
    points.push({ bucket: b.takenAt, rx: dRx / dt, tx: dTx / dt });
  }
  return points;
}

function Traffic({ snapshots }: { snapshots: Snapshot[] }) {
  const points = useMemo(() => buildTraffic(snapshots), [snapshots]);
  if (points.length < 2) return <p className="empty">sin tráfico medible aún (necesitamos ≥2 snapshots).</p>;

  const maxRx = Math.max(...points.map((p) => p.rx));
  const maxTx = Math.max(...points.map((p) => p.tx));
  const peakRx = fmtBytesPerSec(maxRx);
  const peakTx = fmtBytesPerSec(maxTx);

  return (
    <div className="traffic">
      <div className="traffic-summary">
        <span className="traffic-pill traffic-rx">↓ pico {peakRx}</span>
        <span className="traffic-pill traffic-tx">↑ pico {peakTx}</span>
      </div>
      <div className="chart" style={{ padding: "0.6rem 0.3rem 0.3rem" }}>
        <ResponsiveContainer width="100%" height={200}>
          <AreaChart data={points} margin={{ top: 4, right: 12, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="rxGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#4cc9f0" stopOpacity={0.55} />
                <stop offset="100%" stopColor="#4cc9f0" stopOpacity={0} />
              </linearGradient>
              <linearGradient id="txGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#fbbf24" stopOpacity={0.55} />
                <stop offset="100%" stopColor="#fbbf24" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke="#30363d" strokeDasharray="3 3" />
            <XAxis dataKey="bucket" tickFormatter={fmtTimeShort} stroke="#6b7280" fontSize={11} />
            <YAxis stroke="#6b7280" fontSize={11} tickFormatter={fmtBytesPerSec} width={70} />
            <Tooltip
              contentStyle={{ background: "#161b22", border: "1px solid #30363d", borderRadius: 4 }}
              labelFormatter={(v) => fmtFull(v as string)}
              formatter={(value: number, name: string) => [fmtBytesPerSec(value), name === "rx" ? "↓ rx" : "↑ tx"]}
            />
            <Area type="monotone" dataKey="rx" stroke="#4cc9f0" fill="url(#rxGrad)" name="rx" />
            <Area type="monotone" dataKey="tx" stroke="#fbbf24" fill="url(#txGrad)" name="tx" />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function Gantt({ snapshots }: { snapshots: Snapshot[] }) {
  const now = Date.now();
  const windowStart = now - WINDOW_MS;
  const totalMin = 24 * 60;

  const segments = useMemo(() => buildSegments(snapshots, now), [snapshots, now]);

  if (segments.length === 0) return <p className="empty">sin snapshots en las últimas 24h.</p>;

  const onlineMs = segments.filter((s) => s.online).reduce((a, s) => a + (s.end - s.start), 0);
  const onlinePct = Math.round((onlineMs / WINDOW_MS) * 100);

  const ticks = [-24, -18, -12, -6, 0];

  return (
    <div className="gantt">
      <div className="gantt-summary">
        <span className="gantt-pct">{onlinePct}%</span>
        <span className="gantt-pct-lbl">online en últimas 24h</span>
      </div>
      <svg
        className="gantt-svg"
        viewBox={`0 0 ${totalMin} 30`}
        preserveAspectRatio="none"
        role="img"
        aria-label="timeline 24h"
      >
        {segments.map((s, i) => {
          const x = (s.start - windowStart) / 60000;
          const w = (s.end - s.start) / 60000;
          return (
            <rect
              key={i}
              x={x}
              y={0}
              width={Math.max(w, 0.5)}
              height={30}
              fill={s.online ? "#4ade80" : "#6b7280"}
              opacity={s.online ? 0.85 : 0.35}
            >
              <title>
                {fmtFull(new Date(s.start).toISOString())} → {fmtFull(new Date(s.end).toISOString())} (
                {s.online ? "online" : "offline"})
              </title>
            </rect>
          );
        })}
      </svg>
      <div className="gantt-ticks">
        {ticks.map((h) => {
          const t = new Date(now + h * 3600 * 1000);
          const left = ((h + 24) / 24) * 100;
          return (
            <span key={h} className="gantt-tick" style={{ left: `${left}%` }}>
              {h === 0 ? "ahora" : t.toLocaleTimeString("es", { hour: "2-digit", minute: "2-digit" })}
            </span>
          );
        })}
      </div>
    </div>
  );
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
            <h3>actividad — últimas 24h</h3>
            <Gantt snapshots={data.snapshots} />
          </section>
        )}

        {data && (
          <section>
            <h3>tráfico</h3>
            <Traffic snapshots={data.snapshots} />
          </section>
        )}

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
