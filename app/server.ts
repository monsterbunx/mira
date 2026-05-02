import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const PORT = Number(process.env.PORT ?? 3000);
const TS_URL = process.env.TAILSCALE_STATUS_URL ?? "http://host.docker.internal:41642/status";
const POLL_MS = Number(process.env.POLL_INTERVAL_MS ?? 30000);

type TSPeer = {
  ID?: string;
  HostName?: string;
  DNSName?: string;
  OS?: string;
  TailscaleIPs?: string[];
  Online?: boolean;
  RxBytes?: number;
  TxBytes?: number;
  LastSeen?: string;
};
type TSStatus = {
  Self?: TSPeer;
  Peer?: Record<string, TSPeer>;
  BackendState?: string;
};

const json = (data: unknown, init?: ResponseInit) =>
  new Response(JSON.stringify(data, replacer, 2), {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });

// BigInt-safe JSON
function replacer(_k: string, v: unknown) {
  return typeof v === "bigint" ? v.toString() : v;
}

function normalize(p: TSPeer): {
  id: string;
  name: string;
  os: string | null;
  ipv4: string | null;
  tailnetIp: string | null;
  online: boolean;
  rxBytes: bigint | null;
  txBytes: bigint | null;
} | null {
  if (!p?.ID) return null;
  const tIp = p.TailscaleIPs?.find((ip) => /^100\./.test(ip)) ?? null;
  const ipv4 = p.TailscaleIPs?.find((ip) => /^\d+\.\d+\.\d+\.\d+$/.test(ip)) ?? null;
  return {
    id: p.ID,
    name: p.HostName ?? p.DNSName ?? p.ID,
    os: p.OS ?? null,
    ipv4,
    tailnetIp: tIp,
    online: !!p.Online,
    rxBytes: p.RxBytes != null ? BigInt(p.RxBytes) : null,
    txBytes: p.TxBytes != null ? BigInt(p.TxBytes) : null,
  };
}

async function pollOnce() {
  let raw: TSStatus;
  try {
    const res = await fetch(TS_URL);
    if (!res.ok) {
      console.warn(`[poll] tailscale not ready: HTTP ${res.status}`);
      return;
    }
    const text = await res.text();
    // El bridge devuelve el cuerpo de tailscale status --json directamente o un wrapper string
    raw = text.trim().startsWith("{") ? JSON.parse(text) : (JSON.parse(JSON.parse(text)) as TSStatus);
  } catch (e) {
    console.warn(`[poll] tailscale fetch failed: ${e}`);
    return;
  }

  if (raw.BackendState && raw.BackendState !== "Running") {
    console.warn(`[poll] backend state: ${raw.BackendState}`);
    return;
  }

  const peers: TSPeer[] = [];
  if (raw.Self) peers.push(raw.Self);
  if (raw.Peer) peers.push(...Object.values(raw.Peer));

  const now = new Date();
  for (const p of peers) {
    const n = normalize(p);
    if (!n) continue;

    const prev = await prisma.device.findUnique({ where: { id: n.id } });
    const wasOnline = prev?.online ?? false;

    const deviceData = {
      id: n.id,
      name: n.name,
      os: n.os,
      ipv4: n.ipv4,
      tailnetIp: n.tailnetIp,
      online: n.online,
    };

    await prisma.device.upsert({
      where: { id: n.id },
      create: { ...deviceData, lastSeen: now },
      update: {
        ...deviceData,
        lastSeen: n.online ? now : prev?.lastSeen ?? now,
      },
    });

    await prisma.snapshot.create({
      data: {
        deviceId: n.id,
        online: n.online,
        rxBytes: n.rxBytes,
        txBytes: n.txBytes,
      },
    });

    if (!prev) {
      await prisma.event.create({ data: { deviceId: n.id, kind: "first_seen" } });
    } else if (wasOnline !== n.online) {
      await prisma.event.create({ data: { deviceId: n.id, kind: n.online ? "online" : "offline" } });
    }
  }

  console.log(`[poll] ${peers.length} peers — ${peers.filter((p) => p.Online).length} online`);
}

// Inicia el poller (no bloquea boot)
setTimeout(() => {
  pollOnce().catch((e) => console.error("[poll] error:", e));
  setInterval(() => pollOnce().catch((e) => console.error("[poll] error:", e)), POLL_MS);
}, 5000);

const server = Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);

    if (req.method === "GET" && url.pathname === "/") {
      return json({ name: "mira", endpoints: ["/health", "/devices", "/devices/:id/history", "/timeline", "/poll"] });
    }

    if (req.method === "GET" && url.pathname === "/health") {
      try {
        await prisma.$queryRaw`SELECT 1`;
        const tsRes = await fetch(TS_URL.replace("/status", "/health")).catch(() => null);
        const ts = tsRes?.ok ? ((await tsRes.json()) as { tailscale?: string }) : null;
        return json({ ok: true, db: "up", tailscale: ts?.tailscale ?? "unknown" });
      } catch (err) {
        return json({ ok: false, db: "down", error: String(err) }, { status: 503 });
      }
    }

    if (req.method === "GET" && url.pathname === "/devices") {
      const devices = await prisma.device.findMany({ orderBy: [{ online: "desc" }, { name: "asc" }] });
      return json(devices);
    }

    if (req.method === "POST" && url.pathname === "/poll") {
      await pollOnce();
      return json({ ok: true });
    }

    if (req.method === "GET" && url.pathname === "/timeline") {
      // Online count agregado en buckets de 5min para las últimas 24h
      const since = new Date(Date.now() - 24 * 3600 * 1000);
      const rows = await prisma.$queryRaw<Array<{ bucket: Date; online_count: bigint; total: bigint }>>`
        SELECT
          to_timestamp(floor(extract(epoch from "takenAt")/300)*300) AT TIME ZONE 'UTC' as bucket,
          SUM(CASE WHEN online THEN 1 ELSE 0 END) as online_count,
          COUNT(DISTINCT "deviceId") as total
        FROM "Snapshot"
        WHERE "takenAt" >= ${since}
        GROUP BY bucket
        ORDER BY bucket ASC
      `;
      return json(
        rows.map((r) => ({
          bucket: r.bucket,
          online: Number(r.online_count),
          total: Number(r.total),
        })),
      );
    }

    const m = url.pathname.match(/^\/devices\/([^/]+)\/history$/);
    if (req.method === "GET" && m) {
      const id = decodeURIComponent(m[1]);
      const since = new Date(Date.now() - 24 * 3600 * 1000);
      const [device, events, snapshots] = await Promise.all([
        prisma.device.findUnique({ where: { id } }),
        prisma.event.findMany({ where: { deviceId: id, at: { gte: since } }, orderBy: { at: "asc" } }),
        prisma.snapshot.findMany({
          where: { deviceId: id, takenAt: { gte: since } },
          orderBy: { takenAt: "asc" },
          take: 500,
        }),
      ]);
      if (!device) return json({ error: "not found" }, { status: 404 });
      return json({ device, events, snapshots });
    }

    return json({ error: "not found" }, { status: 404 });
  },
});

console.log(`mira listening on http://0.0.0.0:${server.port} (poll ${TS_URL} every ${POLL_MS}ms)`);
