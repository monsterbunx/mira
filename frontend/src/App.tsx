import { useEffect, useMemo, useState } from "react";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
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

type TimelinePoint = {
  bucket: string;
  online: number;
  total: number;
};

type Health = {
  ok: boolean;
  db?: string;
  tailscale?: string;
  error?: string;
};

type StatusFilter = "all" | "online" | "offline";

const REFRESH_MS = 15000;

const OS_CATEGORIES = [
  { key: "linux", label: "Linux", icon: "🐧" },
  { key: "macos", label: "macOS", icon: "🍎" },
  { key: "windows", label: "Windows", icon: "🪟" },
  { key: "ios", label: "iOS", icon: "📱" },
  { key: "android", label: "Android", icon: "🤖" },
  { key: "other", label: "Otro", icon: "💻" },
] as const;

function osCategory(os: string | null): string {
  if (!os) return "other";
  const s = os.toLowerCase();
  if (s.includes("linux")) return "linux";
  if (s.includes("macos") || s.includes("darwin")) return "macos";
  if (s.includes("windows")) return "windows";
  if (s.includes("ios")) return "ios";
  if (s.includes("android")) return "android";
  return "other";
}

function osIcon(os: string | null) {
  return OS_CATEGORIES.find((c) => c.key === osCategory(os))?.icon ?? "💻";
}

function relTime(iso: string) {
  const d = new Date(iso);
  const diffMs = Date.now() - d.getTime();
  const s = Math.floor(diffMs / 1000);
  if (s < 60) return `hace ${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `hace ${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `hace ${h}h`;
  const d2 = Math.floor(h / 24);
  return `hace ${d2}d`;
}

function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString("es", { hour: "2-digit", minute: "2-digit" });
}

function readParams() {
  const p = new URLSearchParams(window.location.search);
  return {
    q: p.get("q") ?? "",
    os: new Set((p.get("os") ?? "").split(",").filter(Boolean)),
    status: (p.get("status") as StatusFilter) || "all",
  };
}

function writeParams(state: { q: string; os: Set<string>; status: StatusFilter }) {
  const p = new URLSearchParams();
  if (state.q) p.set("q", state.q);
  if (state.os.size > 0) p.set("os", Array.from(state.os).join(","));
  if (state.status !== "all") p.set("status", state.status);
  const qs = p.toString();
  const url = qs ? `?${qs}` : window.location.pathname;
  window.history.replaceState({}, "", url);
}

export default function App() {
  const [devices, setDevices] = useState<Device[]>([]);
  const [timeline, setTimeline] = useState<TimelinePoint[]>([]);
  const [health, setHealth] = useState<Health | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const initial = readParams();
  const [search, setSearch] = useState(initial.q);
  const [osFilter, setOsFilter] = useState<Set<string>>(initial.os);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>(initial.status);

  useEffect(() => {
    writeParams({ q: search, os: osFilter, status: statusFilter });
  }, [search, osFilter, statusFilter]);

  async function refreshAll() {
    setError(null);
    try {
      const [d, t, h] = await Promise.all([
        fetch("/api/devices").then((r) => r.json()),
        fetch("/api/timeline").then((r) => r.json()),
        fetch("/api/health").then((r) => r.json()),
      ]);
      setDevices(d);
      setTimeline(t);
      setHealth(h);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  async function forcePoll() {
    await fetch("/api/poll", { method: "POST" });
    refreshAll();
  }

  useEffect(() => {
    refreshAll();
    const t = setInterval(refreshAll, REFRESH_MS);
    return () => clearInterval(t);
  }, []);

  const onlineCount = devices.filter((d) => d.online).length;

  const visibleDevices = useMemo(() => {
    const q = search.trim().toLowerCase();
    return devices.filter((d) => {
      if (q && !d.name.toLowerCase().includes(q) && !(d.tailnetIp ?? "").includes(q)) return false;
      if (osFilter.size > 0 && !osFilter.has(osCategory(d.os))) return false;
      if (statusFilter === "online" && !d.online) return false;
      if (statusFilter === "offline" && d.online) return false;
      return true;
    });
  }, [devices, search, osFilter, statusFilter]);

  function toggleOs(key: string) {
    setOsFilter((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function clearFilters() {
    setSearch("");
    setOsFilter(new Set());
    setStatusFilter("all");
  }

  const filtersActive = search !== "" || osFilter.size > 0 || statusFilter !== "all";

  return (
    <main>
      <header>
        <div>
          <h1>mira</h1>
          <p className="sub">tailscale dashboard</p>
        </div>
        <div className="badges">
          <span className={`badge badge-${health?.db === "up" ? "ok" : "down"}`}>db: {health?.db ?? "?"}</span>
          <span className={`badge badge-${health?.tailscale === "up" ? "ok" : "down"}`}>
            tailscale: {health?.tailscale ?? "?"}
          </span>
          <button className="poll-btn" onClick={forcePoll} title="forzar refresh">↻</button>
        </div>
      </header>

      {error && <div className="error">{error}</div>}

      <section className="kpis">
        <div className="kpi">
          <div className="kpi-num">{onlineCount}</div>
          <div className="kpi-label">online</div>
        </div>
        <div className="kpi">
          <div className="kpi-num">{devices.length}</div>
          <div className="kpi-label">total</div>
        </div>
        <div className="kpi">
          <div className="kpi-num">{devices.length - onlineCount}</div>
          <div className="kpi-label">offline</div>
        </div>
      </section>

      <section>
        <h2>actividad — últimas 24h</h2>
        {timeline.length === 0 ? (
          <p className="empty">sin datos todavía. el poller corre cada 30s; aparecerán snapshots pronto.</p>
        ) : (
          <div className="chart">
            <ResponsiveContainer width="100%" height={260}>
              <AreaChart data={timeline} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="onlineGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#fbbf24" stopOpacity={0.6} />
                    <stop offset="100%" stopColor="#fbbf24" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="totalGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#4cc9f0" stopOpacity={0.3} />
                    <stop offset="100%" stopColor="#4cc9f0" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="#30363d" strokeDasharray="3 3" />
                <XAxis dataKey="bucket" tickFormatter={fmtTime} stroke="#6b7280" fontSize={11} />
                <YAxis stroke="#6b7280" fontSize={11} allowDecimals={false} />
                <Tooltip
                  contentStyle={{ background: "#161b22", border: "1px solid #30363d", borderRadius: 4 }}
                  labelFormatter={fmtTime}
                />
                <Legend />
                <Area type="monotone" dataKey="total" stroke="#4cc9f0" fill="url(#totalGrad)" name="total" />
                <Area type="monotone" dataKey="online" stroke="#fbbf24" fill="url(#onlineGrad)" name="online" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}
      </section>

      <section>
        <div className="section-head">
          <h2>
            dispositivos ({visibleDevices.length}
            {filtersActive && visibleDevices.length !== devices.length ? ` / ${devices.length}` : ""})
          </h2>
          {filtersActive && (
            <button className="clear-btn" onClick={clearFilters} title="limpiar filtros">
              limpiar filtros ✕
            </button>
          )}
        </div>

        <div className="filters">
          <input
            className="search"
            type="search"
            placeholder="buscar por nombre o IP…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            autoComplete="off"
          />
          <div className="chip-row">
            {(["all", "online", "offline"] as const).map((s) => (
              <button
                key={s}
                className={`chip chip-status ${statusFilter === s ? "active" : ""}`}
                onClick={() => setStatusFilter(s)}
              >
                {s === "all" ? "todos" : s}
              </button>
            ))}
          </div>
          <div className="chip-row">
            {OS_CATEGORIES.map((c) => (
              <button
                key={c.key}
                className={`chip chip-os ${osFilter.has(c.key) ? "active" : ""}`}
                onClick={() => toggleOs(c.key)}
                title={c.label}
              >
                <span>{c.icon}</span> {c.label}
              </button>
            ))}
          </div>
        </div>

        {loading ? (
          <p className="empty">cargando…</p>
        ) : devices.length === 0 ? (
          <p className="empty">no hay dispositivos. autoriza el contenedor tailscale (ver logs) y espera al poller.</p>
        ) : visibleDevices.length === 0 ? (
          <p className="empty">ningún device coincide con los filtros.</p>
        ) : (
          <ul className="cards">
            {visibleDevices.map((d) => (
              <li key={d.id} className={`card ${d.online ? "online" : "offline"}`}>
                <div className="card-head">
                  <span className="card-icon">{osIcon(d.os)}</span>
                  <div>
                    <strong>{d.name}</strong>
                    <small className="card-os">{d.os ?? "—"}</small>
                  </div>
                  <span className={`dot dot-${d.online ? "on" : "off"}`} />
                </div>
                <div className="card-body">
                  <div className="row">
                    <span>tailscale</span>
                    <code>{d.tailnetIp ?? "—"}</code>
                  </div>
                  <div className="row">
                    <span>last seen</span>
                    <code>{relTime(d.lastSeen)}</code>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
