# CONTEXT.md — Brotherhood Design & Rationale

## Problem Statement

Two Claude Code instances running on different computers need to communicate in real-time. Traditional MCP (Model Context Protocol) runs on stdio within a single machine. We needed:

- **Cross-machine communication**: Peer A (Mac 1) ↔ Relay ↔ Peer B (Mac 2)
- **Real-time delivery**: Minimal latency for interactive workflows
- **Presence awareness**: Know when peers join/leave the room
- **No persistence**: Stateless, cloud-friendly (no database)
- **Simple authentication**: Shared secret, not OAuth/key infrastructure

## Architecture

### High-Level Flow
```
Claude Code (Alice)
├─ MCP Server (local process)
│  └─ HTTP client → Relay (HTTPS)
│     ├─ POST /rooms/{roomId}/send — send messages
│     └─ GET /rooms/{roomId}/events (SSE) — receive messages + presence

Claude Code (Bob)
├─ MCP Server (local process)
│  └─ HTTP client → Relay (HTTPS)
│     ├─ POST /rooms/{roomId}/send — send messages
│     └─ GET /rooms/{roomId}/events (SSE) — receive messages + presence

Relay (Stateless, Cloud)
├─ Express server
├─ In-memory Map<roomId, Map<peerId, response>>
└─ Broadcasts SSE events to all peers in a room
```

### Component Breakdown

#### Relay (`src/relay.ts`)
- **Purpose**: Pub/sub hub for room-based messaging
- **State**: In-memory `rooms` map (ephemeral, no persistence)
- **Endpoints**:
  - `GET /healthz` — liveness probe, returns active room count
  - `GET /rooms/{roomId}/events` — SSE stream (long-lived connection)
  - `POST /rooms/{roomId}/send` — POST envelope, broadcasts to peers
- **Security**: Bearer token in `Authorization` header, constant-time comparison
- **Scalability**: Single process; Vercel's auto-scaling handles load

#### MCP Server (`src/mcp.ts`)
- **Purpose**: Exposes MCP tools to Claude, manages local message queue
- **Runs**: One instance per Claude Code session (local process)
- **Tools Exposed**:
  - `send_message` — queue message for relay
  - `receive_messages` — drain local queue (non-blocking)
  - `wait_for_message` — long-poll until messages arrive
  - `peer_status` — check connection status & peer list
  - `kill_peer` — graceful shutdown
- **State**: Local queue (`Queue<Envelope>`), relay connection status

#### Relay Client (`src/relay-client.ts`)
- **Purpose**: HTTP abstraction over relay communication
- **Methods**:
  - `connect()` — establish SSE stream, start listening
  - `send()` — POST message envelope
  - `disconnect()` — clean shutdown
- **Resilience**: Reconnect on error, backoff strategy

#### Protocol (`src/protocol.ts`)
- **Shared Types**:
  - `Envelope` — message container (from, to, kind, data)
  - `ServerEvent` — relay broadcasts (hello, peer_joined, peer_left, envelope, ...)
- **Serialization**: JSON for HTTP, SSE newline-delimited for streaming
- **Auth**: `parseBearer()`, `secretsEqual()` (constant-time comparison)

## Why These Choices?

### Why SSE Instead of WebSocket?
- **SSE**: Works through any HTTP reverse proxy, simpler resume on network blip
- **WebSocket**: Requires proxy `Upgrade` support, more state management
- For a relay bridge, SSE's one-way nature (server → client) is sufficient; POST handles client → server

### Why No Persistence?
- **Simplicity**: No database, Redis, or queue infrastructure
- **Statelessness**: Scales horizontally (multiple relay instances possible)
- **Semantics**: In-flight events are transient; Claude's conversation log is the persistent record
- **Cost**: Reduces hosting complexity (Vercel, Railway, etc.)

### Why Bearer Token Auth?
- **Simplicity**: No key rotation, no OAuth infrastructure
- **Sufficient**: HTTPS + strong secret ≥32 chars prevents eavesdropping/forgery
- **Tradeoff**: Single shared secret for all peers in a room (room isolation, not per-user)

### Why In-Memory Room Map?
- **Speed**: Zero latency for presence & message routing
- **Scaling Limit**: Relay assumes reasonable room count (thousands, not millions)
- **Trade-off**: Relay restart drops presence; acceptable because MCP will reconnect

### Why Node.js / Express?
- **Minimal**: Express is lightweight; ~20KB for this relay logic
- **Deployment**: Easy on Vercel, Railway, Fly.io, Docker
- **Developer Experience**: Same language as MCP implementation (TypeScript)

## Message Flow Example

**Alice sends message to Bob:**

```
1. Claude (Alice): call tool "send_message" with text="hello"

2. MCP Server (Alice):
   - Create Envelope: {from: "alice", to: "bob", kind: "text", data: {text: "hello"}}
   - POST to https://relay.example.com/rooms/shared-room-id/send
   - Include Authorization: Bearer {SECRET}

3. Relay:
   - Validate Bearer token (constant-time)
   - Find room → find subscriber with peer="bob"
   - Broadcast via SSE: {kind: "envelope", envelope: {...}}
   - Also broadcast to Alice for echo-awareness

4. MCP Server (Bob):
   - SSE stream receives: {kind: "envelope", envelope: {...}}
   - Deserialize Envelope
   - Enqueue to local `Queue<Envelope>`

5. Claude (Bob): call tool "wait_for_message"
   - MCP drains queue
   - Returns Envelope to Claude
   - Claude displays message
```

**Presence Example:**

```
1. Alice connects: GET /rooms/shared-room-id/events?peer=alice&token={SECRET}
   - Relay sends SSE: {kind: "hello", peers: []}
   - Relay broadcasts to everyone: {kind: "peer_joined", peer: "alice"}

2. Bob connects: GET /rooms/shared-room-id/events?peer=bob&token={SECRET}
   - Relay sends SSE: {kind: "hello", peers: ["alice"]}
   - Relay broadcasts to everyone: {kind: "peer_joined", peer: "bob"}
   - Alice's stream receives the peer_joined event for Bob

3. Alice calls tool "peer_status"
   - MCP returns: {self: "alice", peers: ["bob"], connected_to_relay: true, room_id: "shared-room-id"}
```

## Tradeoffs & Limitations

| Aspect | Current Design | Tradeoff |
|--------|-----------------|----------|
| **Persistence** | None (in-memory) | Fast, simple, stateless vs. message history lost on restart |
| **Scale** | Single relay process | One IP, vertically scales vs. horizontal sharding complex |
| **Auth** | Shared secret | Simpler vs. no per-user audit trail |
| **Latency** | ~100-200ms typical | HTTPS round-trip vs. local stdio (<1ms) |
| **Reliability** | Fire-and-forget posts | Simpler relay vs. retry logic in MCP client |
| **Room Isolation** | By ID + secret | Good vs. no cryptographic isolation per message |

## Future Enhancements (Not Implemented)

- **Persistence**: Add Redis for message history, replay on reconnect
- **Horizontal Scaling**: Implement relay sharding by roomId or consistent hashing
- **Per-User Auth**: JWT or API key per Claude instance, audit logging
- **Compression**: Gzip SSE payloads for large messages
- **Metrics**: Prometheus export for relay health & message throughput
- **Encryption**: End-to-end encryption of envelopes (relay sees only blobs)

## Security Model

### Threat: Eavesdropping
- **Mitigation**: HTTPS (TLS) between MCP & relay
- **Assumption**: TLS certificate validation works

### Threat: Forgery / Token Reuse
- **Mitigation**: Constant-time secret comparison, Bearer token in header
- **Assumption**: Secret ≥32 random bytes, stored securely (env var, not hardcoded)

### Threat: Room Hijacking
- **Mitigation**: Must know both room ID + secret to join
- **Assumption**: Room IDs are unpredictable (random), secrets are long

### Threat: Relay Compromise
- **Mitigation**: Relay sees plaintext messages; use end-to-end encryption if needed (not implemented)
- **Assumption**: Relay operator is trusted, or run relay yourself

### Threat: DoS
- **Mitigation**: Vercel's DDoS protection; rate-limiting not implemented
- **Assumption**: Relay is behind a CDN with DDoS shields

## Development History

- **v1.0.0**: Initial release
  - Basic pub/sub relay with SSE + POST
  - MCP tools for message queue
  - Vercel deployment support

## Glossary

| Term | Definition |
|------|-----------|
| **Room** | Isolated namespace for a pair (or group) of peers sharing the same `BROTHERHOOD_ROOM_ID` |
| **Peer** | One Claude instance + MCP server; identified by `BROTHERHOOD_PEER_NAME` |
| **Envelope** | Message unit: {from, to, kind, data, ts} |
| **ServerEvent** | Relay-generated event: hello, peer_joined, peer_left, envelope, heartbeat |
| **Relay** | Cloud process that routes messages between peers |
| **MCP Server** | Local process running `dist/mcp.js`, registered with Claude Code |
