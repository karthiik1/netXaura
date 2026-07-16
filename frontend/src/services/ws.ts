// WebSocket client (§5, §8): typed message envelope, heartbeat, and
// auto-reconnect with exponential backoff. On reconnect the caller re-syncs
// workspace state via REST (see useWebSocket).

export type ServerMessageType =
  | "member_joined"
  | "member_left"
  | "member_gesturing"
  | "cursor_move"
  | "transfer_pending"
  | "transfer_completed"
  | "transfer_expired"
  | "tab_synced"
  | "workspace_synced"
  | "error";

export interface Envelope<T = Record<string, unknown>> {
  id: string | null;
  type: ServerMessageType | string;
  payload: T;
  ts: string;
}

type Handler = (msg: Envelope) => void;
type StatusHandler = (status: "connecting" | "open" | "closed") => void;

const WS_BASE = import.meta.env.VITE_WS_URL ?? "ws://localhost:8000";
const HEARTBEAT_MS = 15_000; // §5: client pings every 15s

export class WorkspaceSocket {
  private ws: WebSocket | null = null;
  private handlers = new Set<Handler>();
  private statusHandlers = new Set<StatusHandler>();
  private heartbeat?: ReturnType<typeof setInterval>;
  private backoff = 500; // ms, doubles up to a cap
  private readonly maxBackoff = 10_000;
  private closedByUser = false;

  constructor(
    private code: string,
    private deviceId: string,
    private token: string,
  ) {}

  connect() {
    this.closedByUser = false;
    this.emitStatus("connecting");
    const url = `${WS_BASE}/ws/${this.code}?device_id=${encodeURIComponent(this.deviceId)}&token=${encodeURIComponent(this.token)}`;
    const ws = new WebSocket(url);
    this.ws = ws;

    ws.onopen = () => {
      this.backoff = 500;
      this.emitStatus("open");
      this.startHeartbeat();
    };
    ws.onmessage = (ev) => {
      let msg: Envelope;
      try {
        msg = JSON.parse(ev.data);
      } catch {
        return;
      }
      this.handlers.forEach((h) => h(msg));
    };
    ws.onclose = () => {
      this.stopHeartbeat();
      this.emitStatus("closed");
      if (!this.closedByUser) this.scheduleReconnect();
    };
    ws.onerror = () => ws.close();
  }

  private scheduleReconnect() {
    const delay = this.backoff;
    this.backoff = Math.min(this.backoff * 2, this.maxBackoff);
    setTimeout(() => {
      if (!this.closedByUser) this.connect();
    }, delay);
  }

  private startHeartbeat() {
    this.stopHeartbeat();
    this.heartbeat = setInterval(() => this.send("heartbeat", {}), HEARTBEAT_MS);
  }

  private stopHeartbeat() {
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.heartbeat = undefined;
  }

  send(type: string, payload: Record<string, unknown>) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(
        JSON.stringify({
          id: crypto.randomUUID(),
          type,
          payload,
          ts: new Date().toISOString(),
        }),
      );
    }
  }

  onMessage(h: Handler) {
    this.handlers.add(h);
    return () => this.handlers.delete(h);
  }

  onStatus(h: StatusHandler) {
    this.statusHandlers.add(h);
    return () => this.statusHandlers.delete(h);
  }

  private emitStatus(s: "connecting" | "open" | "closed") {
    this.statusHandlers.forEach((h) => h(s));
  }

  close() {
    this.closedByUser = true;
    this.stopHeartbeat();
    this.ws?.close();
  }
}
