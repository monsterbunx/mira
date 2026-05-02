type ToastKind = "online" | "offline" | "first_seen";

export type Toast = {
  id: number;
  kind: ToastKind;
  deviceId: string;
  deviceName: string;
  at: string;
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

function kindLabel(kind: ToastKind) {
  if (kind === "online") return "vino online";
  if (kind === "offline") return "se fue offline";
  return "primera vez visto";
}

function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString("es", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export default function Toaster({
  toasts,
  onDismiss,
  onClickToast,
  deviceOs,
}: {
  toasts: Toast[];
  onDismiss: (id: number) => void;
  onClickToast: (deviceId: string) => void;
  deviceOs: Map<string, string | null>;
}) {
  return (
    <div className="toaster" role="region" aria-label="notificaciones">
      {toasts.map((t) => (
        <button
          key={t.id}
          className={`toast toast-${t.kind}`}
          onClick={() => {
            onClickToast(t.deviceId);
            onDismiss(t.id);
          }}
          aria-label={`${t.deviceName} ${kindLabel(t.kind)}`}
        >
          <span className="toast-icon">{osIcon(deviceOs.get(t.deviceId) ?? null)}</span>
          <span className="toast-body">
            <strong>{t.deviceName}</strong>
            <span className="toast-msg">{kindLabel(t.kind)}</span>
          </span>
          <span className="toast-time">{fmtTime(t.at)}</span>
          <span
            className="toast-close"
            role="button"
            aria-label="cerrar"
            onClick={(e) => {
              e.stopPropagation();
              onDismiss(t.id);
            }}
          >
            ✕
          </span>
        </button>
      ))}
    </div>
  );
}
