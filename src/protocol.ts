import { timingSafeEqual } from "crypto";
import { z } from "zod";

export const EnvelopeSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("message"),
    from: z.string().min(1).max(128),
    ts: z.number().int().nonnegative(),
    text: z.string(),
  }),
  z.object({
    kind: z.literal("kill"),
    from: z.string().min(1).max(128),
    ts: z.number().int().nonnegative(),
    reason: z.string().optional(),
  }),
  z.object({
    kind: z.literal("ping"),
    from: z.string().min(1).max(128),
    ts: z.number().int().nonnegative(),
  }),
]);

export type Envelope = z.infer<typeof EnvelopeSchema>;

export type ServerEvent =
  | { kind: "envelope"; envelope: Envelope }
  | { kind: "peer_joined"; peer: string; ts: number }
  | { kind: "peer_left"; peer: string; ts: number }
  | { kind: "hello"; peers: string[]; ts: number };

export function secretsEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

export function parseBearer(header: string | undefined): string | null {
  if (!header) return null;
  const m = /^Bearer\s+(.+)$/i.exec(header.trim());
  return m ? m[1] : null;
}

export function sseEncode(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}
