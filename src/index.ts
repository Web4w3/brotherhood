import dotenv from "dotenv";
import path from "path";
import express, { Request, Response } from "express";

// dotenv.config({ path: path.join(process.cwd(), ".env.local") });
import {
  Envelope,
  EnvelopeSchema,
  ServerEvent,
  parseBearer,
  secretsEqual,
  sseEncode,
} from "./protocol";

const PORT = Number(process.env.PORT ?? 8080);
const SECRET = process.env.BROTHERHOOD_SECRET ?? "";
const HEARTBEAT_MS = 25_000;
const MAX_BODY = "64kb";

if (!SECRET) {
  console.error("BROTHERHOOD_SECRET is required");
  process.exit(1);
}

interface Subscriber {
  id: number;
  peer: string;
  res: Response;
}

const rooms: Map<string, Map<number, Subscriber>> = new Map();
let nextId = 1;

function room(roomId: string): Map<number, Subscriber> {
  let r = rooms.get(roomId);
  if (!r) {
    r = new Map();
    rooms.set(roomId, r);
  }
  return r;
}

function broadcast(roomId: string, event: ServerEvent, exceptId?: number): number {
  const r = rooms.get(roomId);
  if (!r) return 0;
  const payload = sseEncode(event.kind, event);
  let n = 0;
  for (const sub of r.values()) {
    if (exceptId !== undefined && sub.id === exceptId) continue;
    try {
      sub.res.write(payload);
      n++;
    } catch {
      // dropped — connection cleanup will happen via 'close'
    }
  }
  return n;
}

function peerList(roomId: string, exceptId?: number): string[] {
  const r = rooms.get(roomId);
  if (!r) return [];
  const peers: string[] = [];
  for (const sub of r.values()) {
    if (exceptId !== undefined && sub.id === exceptId) continue;
    peers.push(sub.peer);
  }
  return peers;
}

const app = express();
app.use(express.json({ limit: MAX_BODY }));

app.get("/health", (_req, res) => {
  res.json({ ok: true, rooms: rooms.size });
});

app.get("/rooms/:roomId/events", (req: Request, res: Response) => {
  const roomId = req.params.roomId;
  const peer = (req.query.peer as string | undefined)?.trim();
  const token = (req.query.token as string | undefined) ?? "";

  if (!peer || peer.length > 128) {
    res.status(400).json({ error: "missing or invalid peer" });
    return;
  }
  if (!secretsEqual(token, SECRET)) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }

  res.status(200);
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  const id = nextId++;
  const sub: Subscriber = { id, peer, res };
  const r = room(roomId);

  // hello with current peer list (excluding self) before adding self.
  const otherPeers = peerList(roomId);
  res.write(
    sseEncode("hello", { kind: "hello", peers: otherPeers, ts: Date.now() }),
  );

  r.set(id, sub);
  console.log(`[${roomId}] + ${peer} (id=${id}); now ${r.size} subscriber(s)`);

  broadcast(
    roomId,
    { kind: "peer_joined", peer, ts: Date.now() },
    id,
  );

  const heartbeat = setInterval(() => {
    try {
      res.write(": hb\n\n");
    } catch {
      // ignore
    }
  }, HEARTBEAT_MS);

  const cleanup = () => {
    clearInterval(heartbeat);
    if (r.delete(id)) {
      console.log(`[${roomId}] - ${peer} (id=${id}); now ${r.size} subscriber(s)`);
      broadcast(roomId, { kind: "peer_left", peer, ts: Date.now() });
      if (r.size === 0) rooms.delete(roomId);
    }
  };

  req.on("close", cleanup);
  res.on("error", cleanup);
});

app.post("/rooms/:roomId/send", (req: Request, res: Response) => {
  const roomId = req.params.roomId;
  const token = parseBearer(req.headers.authorization);
  if (!token || !secretsEqual(token, SECRET)) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }

  const parsed = EnvelopeSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid envelope", details: parsed.error.flatten() });
    return;
  }
  const envelope: Envelope = parsed.data;

  const r = rooms.get(roomId);
  if (!r) {
    res.json({ delivered: 0 });
    return;
  }

  // Find sender's connection id (best-effort) so we don't echo back to ourselves.
  let exceptId: number | undefined;
  for (const sub of r.values()) {
    if (sub.peer === envelope.from) {
      exceptId = sub.id;
      break;
    }
  }

  const delivered = broadcast(roomId, { kind: "envelope", envelope }, exceptId);
  console.log(`[${roomId}] msg from ${envelope.from} kind=${envelope.kind} delivered=${delivered}`);
  res.json({ delivered });
});

// Export app for both local and serverless environments
export default app;

// Only listen locally (not in Vercel serverless)
if (process.env.VERCEL !== "1") {
  app.listen(PORT, () => {
    console.log(`brotherhood relay listening on :${PORT}`);
  });
}
