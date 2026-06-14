import dotenv from "dotenv";
import path from "path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

dotenv.config({ path: path.join(process.cwd(), ".env.local") });
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import os from "os";
import { z } from "zod/v3";
import { RelayClient } from "./relay-client";

const RELAY_URL = process.env.BROTHERHOOD_RELAY_URL ?? "";
const ROOM_ID = process.env.BROTHERHOOD_ROOM_ID ?? "";
const SECRET = process.env.BROTHERHOOD_SECRET ?? "";
const PEER_NAME = process.env.BROTHERHOOD_PEER_NAME ?? os.hostname();

if (!RELAY_URL || !ROOM_ID || !SECRET) {
  console.error(
    "brotherhood: BROTHERHOOD_RELAY_URL, BROTHERHOOD_ROOM_ID, and BROTHERHOOD_SECRET are required",
  );
  process.exit(1);
}

const client = new RelayClient({
  relayUrl: RELAY_URL,
  roomId: ROOM_ID,
  secret: SECRET,
  peerName: PEER_NAME,
});

client.setKillHandler((env) => {
  const reason = env.reason ? `: ${env.reason}` : "";
  console.error(`brotherhood: kill received from ${env.from}${reason}; exiting`);
  setTimeout(() => process.exit(0), 50);
});

client.start();

const server = new McpServer({
  name: "brotherhood",
  version: "1.0.0",
});

server.registerTool(
  "send_message",
  {
    description: "Send a text message to the peer Claude session in this brotherhood room.",
    inputSchema: {
      text: z.string().min(1).describe("Message text to send to the peer"),
    },
  },
  async ({ text }) => {
    const { delivered } = await client.send({
      kind: "message",
      from: PEER_NAME,
      ts: Date.now(),
      text,
    });
    return {
      content: [
        { type: "text", text: JSON.stringify({ delivered, peer_count: delivered }) },
      ],
    };
  },
);

server.registerTool(
  "receive_messages",
  {
    description:
      "Drain and return all messages received from the peer since the last call. Non-blocking; returns an empty list if nothing is buffered.",
    inputSchema: {
      max: z
        .number()
        .int()
        .positive()
        .max(200)
        .default(50)
        .describe("Maximum number of messages to return"),
    },
  },
  async ({ max }) => {
    const envs = client.drain(max);
    return {
      content: [{ type: "text", text: JSON.stringify({ messages: envs }) }],
    };
  },
);

server.registerTool(
  "wait_for_message",
  {
    description:
      "Block until a message arrives from the peer, or until the timeout elapses. Returns any messages that arrived; empty list on timeout.",
    inputSchema: {
      timeout_seconds: z
        .number()
        .int()
        .positive()
        .max(300)
        .default(30)
        .describe("Maximum seconds to wait (1-300, default 30)"),
    },
  },
  async ({ timeout_seconds }) => {
    const envs = await client.waitForMessages(timeout_seconds * 1000);
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({ messages: envs, timed_out: envs.length === 0 }),
        },
      ],
    };
  },
);

server.registerTool(
  "peer_status",
  {
    description:
      "Return this session's name, the peers currently connected to the room, and whether the relay connection is live.",
    inputSchema: {},
  },
  async () => {
    const status = client.getStatus();
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            self: status.self,
            peers: status.peers,
            connected_to_relay: status.connected,
            room_id: ROOM_ID,
          }),
        },
      ],
    };
  },
);

server.registerTool(
  "kill_peer",
  {
    description:
      "Send a kill signal to all peer sessions in the room. Each receiving brotherhood MCP server will log the reason and exit, which the peer's Claude will surface as a disconnected MCP server. This does not kill the peer's terminal or Claude process itself.",
    inputSchema: {
      reason: z
        .string()
        .max(500)
        .optional()
        .describe("Optional human-readable reason shown in the peer's logs"),
    },
  },
  async ({ reason }) => {
    const { delivered } = await client.send({
      kind: "kill",
      from: PEER_NAME,
      ts: Date.now(),
      reason,
    });
    return {
      content: [{ type: "text", text: JSON.stringify({ delivered }) }],
    };
  },
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
