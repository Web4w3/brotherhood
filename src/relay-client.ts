import EventSource from "eventsource";
import {
  Envelope,
  EnvelopeSchema,
  ServerEvent,
} from "./protocol";

export interface RelayClientOptions {
  relayUrl: string;
  roomId: string;
  secret: string;
  peerName: string;
  log?: (msg: string) => void;
}

type Waiter = {
  resolve: (envs: Envelope[]) => void;
  timer: NodeJS.Timeout;
};

const MIN_BACKOFF_MS = 500;
const MAX_BACKOFF_MS = 15_000;

export class RelayClient {
  private es: EventSource | null = null;
  private backoff = MIN_BACKOFF_MS;
  private closed = false;
  private queue: Envelope[] = [];
  private peers = new Set<string>();
  private connected = false;
  private waiters: Waiter[] = [];
  private onKill: ((envelope: Envelope & { kind: "kill" }) => void) | null = null;
  private log: (msg: string) => void;

  constructor(private opts: RelayClientOptions) {
    this.log = opts.log ?? ((m) => console.error(`[brotherhood] ${m}`));
  }

  start(): void {
    this.connect();
  }

  stop(): void {
    this.closed = true;
    this.es?.close();
    this.es = null;
    for (const w of this.waiters) {
      clearTimeout(w.timer);
      w.resolve([]);
    }
    this.waiters = [];
  }

  setKillHandler(fn: (envelope: Envelope & { kind: "kill" }) => void): void {
    this.onKill = fn;
  }

  getStatus(): { self: string; peers: string[]; connected: boolean } {
    return {
      self: this.opts.peerName,
      peers: [...this.peers].sort(),
      connected: this.connected,
    };
  }

  drain(max: number): Envelope[] {
    const n = Math.min(max, this.queue.length);
    return this.queue.splice(0, n);
  }

  waitForMessages(timeoutMs: number): Promise<Envelope[]> {
    if (this.queue.length > 0) {
      return Promise.resolve(this.drain(50));
    }
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        const idx = this.waiters.findIndex((w) => w.timer === timer);
        if (idx >= 0) this.waiters.splice(idx, 1);
        resolve(this.drain(50));
      }, timeoutMs);
      this.waiters.push({ resolve, timer });
    });
  }

  async send(envelope: Envelope): Promise<{ delivered: number }> {
    const url = `${this.opts.relayUrl.replace(/\/$/, "")}/rooms/${encodeURIComponent(
      this.opts.roomId,
    )}/send`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.opts.secret}`,
      },
      body: JSON.stringify(envelope),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`relay POST ${res.status}: ${text || res.statusText}`);
    }
    return (await res.json()) as { delivered: number };
  }

  private connect(): void {
    if (this.closed) return;

    const url = `${this.opts.relayUrl.replace(/\/$/, "")}/rooms/${encodeURIComponent(
      this.opts.roomId,
    )}/events?peer=${encodeURIComponent(this.opts.peerName)}&token=${encodeURIComponent(
      this.opts.secret,
    )}`;

    this.log(`connecting to ${this.opts.relayUrl} as ${this.opts.peerName}`);

    const es = new EventSource(url);
    this.es = es;

    es.addEventListener("open", () => {
      this.connected = true;
      this.backoff = MIN_BACKOFF_MS;
      this.log(`connected`);
    });

    es.addEventListener("hello", (ev) => this.onEvent(ev as MessageEvent));
    es.addEventListener("envelope", (ev) => this.onEvent(ev as MessageEvent));
    es.addEventListener("peer_joined", (ev) => this.onEvent(ev as MessageEvent));
    es.addEventListener("peer_left", (ev) => this.onEvent(ev as MessageEvent));

    es.addEventListener("error", () => {
      this.connected = false;
      if (this.closed) return;
      es.close();
      this.es = null;
      const wait = this.backoff;
      this.backoff = Math.min(this.backoff * 2, MAX_BACKOFF_MS);
      this.log(`disconnected; retrying in ${wait}ms`);
      setTimeout(() => this.connect(), wait);
    });
  }

  private onEvent(ev: MessageEvent): void {
    let parsed: ServerEvent;
    try {
      parsed = JSON.parse(ev.data) as ServerEvent;
    } catch {
      return;
    }

    switch (parsed.kind) {
      case "hello":
        this.peers = new Set(parsed.peers);
        break;
      case "peer_joined":
        this.peers.add(parsed.peer);
        break;
      case "peer_left":
        this.peers.delete(parsed.peer);
        break;
      case "envelope": {
        const envCheck = EnvelopeSchema.safeParse(parsed.envelope);
        if (!envCheck.success) return;
        const env = envCheck.data;
        if (env.from === this.opts.peerName) return; // safety: ignore echoes
        if (env.kind === "kill") {
          this.onKill?.(env);
          return;
        }
        this.queue.push(env);
        this.flushWaiters();
        break;
      }
    }
  }

  private flushWaiters(): void {
    while (this.waiters.length > 0 && this.queue.length > 0) {
      const w = this.waiters.shift()!;
      clearTimeout(w.timer);
      w.resolve(this.drain(50));
    }
  }
}
