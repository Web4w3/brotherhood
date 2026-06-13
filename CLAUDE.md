# CLAUDE.md — Brotherhood Development Guide

## Overview
**Brotherhood** is an MCP bridge enabling inter-session communication between two Claude Code instances on different computers via a cloud relay. The relay uses Express, SSE (Server-Sent Events), and HTTP POST for real-time pub/sub messaging.

## Project Structure
```
brotherhood/
├── src/
│   ├── relay.ts           # Express relay server (cloud)
│   ├── mcp.ts             # MCP server (local, in each Claude session)
│   ├── relay-client.ts    # HTTP client for relay communication
│   └── protocol.ts        # Shared types & serialization
├── dist/
│   ├── relay.js           # Compiled relay (deployed to Vercel)
│   └── mcp.js             # Compiled MCP server (used locally)
├── vercel.json            # Vercel deployment config
├── .mcp.json              # MCP server registration (local)
└── package.json           # Node.js dependencies
```

## Development Workflow

### Setup
```bash
npm install
npm run typecheck  # Catch TypeScript errors early
npm run build      # Compile both MCP and relay
```

### Local Testing (Smoke Test)
Run this in 3 terminals to test end-to-end:

**Terminal 1 — Relay**
```bash
BROTHERHOOD_SECRET=test PORT=8080 node dist/relay.js
```

**Terminal 2 — Alice**
```bash
BROTHERHOOD_RELAY_URL=http://localhost:8080 \
BROTHERHOOD_ROOM_ID=test \
BROTHERHOOD_SECRET=test \
BROTHERHOOD_PEER_NAME=alice \
node dist/mcp.js
```

**Terminal 3 — Bob**
```bash
BROTHERHOOD_RELAY_URL=http://localhost:8080 \
BROTHERHOOD_ROOM_ID=test \
BROTHERHOOD_SECRET=test \
BROTHERHOOD_PEER_NAME=bob \
node dist/mcp.js
```

Then in Claude (alice), call `peer_status` → should see bob listed. Send a message, bob receives it.

### Code Changes

**Relay changes** → affects all deployed instances
- Edit `src/relay.ts`
- Run `npm run build:relay`
- Test locally first (use smoke test above)
- Commit & push; Vercel redeploys automatically

**MCP changes** → each Claude session rebuilds independently
- Edit `src/mcp.ts` or `src/relay-client.ts`
- Run `npm run typecheck && npm run build`
- Restart Claude Code to pick up new binary

**Protocol changes** → both must match
- Edit `src/protocol.ts`
- Test both sides: `npm run typecheck && npm run build`

## Key Files & Responsibilities

| File | Purpose | Edit When |
|------|---------|-----------|
| `relay.ts` | Express server, message routing, SSE streaming | Adding new endpoints, changing pub/sub logic |
| `mcp.ts` | MCP interface, tool definitions, local queue | Adding new MCP tools, changing tool behavior |
| `relay-client.ts` | HTTP client to communicate with relay | Changing retry logic, auth, request format |
| `protocol.ts` | Shared types: `Envelope`, `ServerEvent`, auth helpers | Adding new message kinds, changing serialization |

## Testing

### Unit / Type Checking
```bash
npm run typecheck
```

### Integration (Local Smoke Test)
See "Local Testing" section above. Validates:
- Relay listens and accepts connections
- Messages route correctly between peers
- SSE streaming works
- Bearer token auth works

### Production Testing
After deploying to Vercel:
```bash
curl https://mcp-proxy.web4w3.com/healthz
```
Should return `{"ok":true,"rooms":0}`.

## Debugging

### Relay Logs
```bash
# Local
BROTHERHOOD_SECRET=test PORT=8080 node dist/relay.js

# Vercel (live)
# Go to Vercel dashboard → Deployments → Latest → Logs
```

Look for:
- `[roomId] + peer` — connection joined
- `[roomId] - peer` — connection dropped
- `[roomId] msg from X delivered=N` — message routing

### MCP Logs
When running locally: `node dist/mcp.js` logs directly to stderr.
In Claude: Claude's output panel shows MCP stderr + stdout.

### Network Debugging
```bash
# Test relay health
curl https://mcp-proxy.web4w3.com/healthz

# Test auth (replace SECRET)
curl -X POST https://mcp-proxy.web4w3.com/rooms/test/send \
  -H "Authorization: Bearer YOUR_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"from":"test","kind":"ping","to":"*","data":{}}'

# Watch SSE stream (replace SECRET)
curl -N "https://mcp-proxy.web4w3.com/rooms/test/events?peer=alice&token=YOUR_SECRET"
```

## Deployment

### Development Deployments
```bash
git push origin main
# Vercel auto-deploys (watch dashboard for status)
```

### Manual Rollback
Vercel dashboard → Deployments → Click desired commit → Redeploy

### Environment Variables
Set in Vercel project Settings → Environment Variables:
- `BROTHERHOOD_SECRET` — required, ≥32 random chars

## Security Considerations

- **Relay**: Always behind HTTPS. Bearer token + room ID sent on every request. Use constant-time compare for secrets (implemented in protocol.ts).
- **Room ID**: Treat as private. Anyone with both room ID + secret can join.
- **No persistence**: Relay restarts drop all presence & in-flight events.
- **MCP server**: No audit trail; Claude's conversation log is the record.

See README.md "Security" section for full details.

## Common Tasks

### Add a New MCP Tool
1. Define tool schema in `mcp.ts` under `callTool()`
2. Handle it in the switch statement
3. Return result or error
4. Build & restart Claude: `npm run build && restart Claude`

### Change Message Format
1. Update `Envelope` or `ServerEvent` types in `protocol.ts`
2. Run `npm run typecheck` to catch all uses
3. Update sender and receiver code
4. Build both: `npm run build`
5. Test on both MCP instances

### Deploy Relay Changes
1. Edit `src/relay.ts`
2. `npm run typecheck && npm run build:relay`
3. Test locally (smoke test, 3 terminals)
4. `git commit -m "..."`
5. `git push origin main` — Vercel deploys automatically

## Troubleshooting

| Issue | Solution |
|-------|----------|
| **TypeError in relay** | Check `relay.ts` syntax. Run `npm run typecheck`. |
| **MCP tool not found** | Ensure tool is defined in `callTool()` switch statement. Rebuild & restart Claude. |
| **Auth failures (401)** | Verify `BROTHERHOOD_SECRET` matches in both relay & MCP config. Check Vercel env vars. |
| **Connection timeouts** | Test relay health: `curl /healthz`. Check Vercel logs for errors. |
| **Stale relay.js binary** | Clear Claude's cache: Restart Claude Code completely. |
| **SSE stream breaks** | Check proxy `X-Accel-Buffering: no` header is set (it is in relay.ts). |

## Resources

- [README.md](./README.md) — User-facing overview, deployment options
- [VERCEL_DEPLOYMENT.md](./VERCEL_DEPLOYMENT.md) — Step-by-step Vercel deployment guide
- [CONTEXT.md](./CONTEXT.md) — Project rationale & design decisions
