# brotherhood

MCP bridge between two Claude Code sessions on different computers.

Each Claude session runs the **brotherhood MCP server** locally. Both MCP servers connect to a shared **brotherhood relay** in the cloud. Messages flow over HTTPS POST in one direction and Server-Sent Events (SSE) in the other.

```
Claude (Mac A) ──stdio──► brotherhood MCP ──POST/SSE──► relay ──POST/SSE──► brotherhood MCP ──stdio──► Claude (Mac B)
```

A pair of sessions is paired by a shared `BROTHERHOOD_ROOM_ID` and `BROTHERHOOD_SECRET`. The relay does not persist anything — it is in-memory pub/sub with presence.

## Build

```sh
npm install
npm run typecheck
npm run build      # produces dist/mcp.js and dist/relay.js
```

## Deploy the relay

The relay is a single Node process that listens on `$PORT` (default `8080`).

### Docker

```sh
docker build -t brotherhood-relay .
docker run --rm -p 8080:8080 -e BROTHERHOOD_SECRET="$(openssl rand -hex 32)" brotherhood-relay
```

### Bare metal

```sh
BROTHERHOOD_SECRET="$(openssl rand -hex 32)" PORT=8080 node dist/relay.js
```

### Fly.io / Render / Railway

Any platform that runs a Node container will work. Put it behind HTTPS — SSE works fine through a reverse proxy as long as response buffering is disabled (we set `X-Accel-Buffering: no`). On Fly.io, make sure your `fly.toml` exposes the HTTP service on the same port.

The relay does not need persistent storage.

## Wire up each Claude session

In each Claude Code config (e.g. `~/.claude.json` or your project's `.mcp.json`), add an entry pointing at the absolute path of your built `dist/mcp.js` and the relay URL. See `examples/claude-mcp-config.json`.

```jsonc
{
  "mcpServers": {
    "brotherhood": {
      "command": "node",
      "args": ["/absolute/path/to/Sources/MCP/brotherhood/dist/mcp.js"],
      "env": {
        "BROTHERHOOD_RELAY_URL": "https://your-relay.example.com",
        "BROTHERHOOD_ROOM_ID": "pick-a-shared-private-id",
        "BROTHERHOOD_SECRET": "long-random-shared-secret",
        "BROTHERHOOD_PEER_NAME": "alice"
      }
    }
  }
}
```

The peer machine uses the same config but with a different `BROTHERHOOD_PEER_NAME` (e.g. `"bob"`). `BROTHERHOOD_PEER_NAME` defaults to the machine's hostname if unset.

## Tools

| Tool | Args | Behavior |
|---|---|---|
| `send_message` | `text: string` | POSTs a message envelope to the relay. Returns `{ delivered }`. |
| `receive_messages` | `max?: number` (1–200, default 50) | Drains the local queue of messages from the peer. Non-blocking. |
| `wait_for_message` | `timeout_seconds?: number` (1–300, default 30) | Long-polls until messages arrive or the timeout elapses. |
| `peer_status` | — | Returns `{ self, peers, connected_to_relay, room_id }`. |
| `kill_peer` | `reason?: string` | Sends a kill signal. Each peer's brotherhood MCP server logs the reason and exits — Claude will surface it as a disconnected MCP server. **Does not kill the peer's terminal or the Claude process itself.** |

## Local end-to-end smoke test

In three terminals on one machine:

```sh
# Terminal 1 — relay
BROTHERHOOD_SECRET=test PORT=8080 node dist/relay.js

# Terminal 2 — alice
BROTHERHOOD_RELAY_URL=http://localhost:8080 \
BROTHERHOOD_ROOM_ID=test \
BROTHERHOOD_SECRET=test \
BROTHERHOOD_PEER_NAME=alice \
node dist/mcp.js  # then drive via Claude or an MCP client

# Terminal 3 — bob
BROTHERHOOD_RELAY_URL=http://localhost:8080 \
BROTHERHOOD_ROOM_ID=test \
BROTHERHOOD_SECRET=test \
BROTHERHOOD_PEER_NAME=bob \
node dist/mcp.js
```

In Claude (alice): call `peer_status` → should list `bob`. Call `send_message` with some text. From Claude (bob): call `wait_for_message` → should return the message.

## Security

- **Always run the relay behind HTTPS.** The bearer token and the room ID are sent on every request.
- Generate a random `BROTHERHOOD_SECRET` (≥32 chars). The relay rejects mismatches with a constant-time compare.
- Treat `BROTHERHOOD_ROOM_ID` as private — anyone with both the room ID and the secret can join the room and read messages.
- The relay holds no history. Restarting it drops presence and any in-flight events that have not been delivered.
- The MCP server has no built-in audit trail — Claude's own conversation log is the record of what was sent.
