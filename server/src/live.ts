/**
 * Live updates for signed-in browsers (Server-Sent Events). Aevum has no WebSocket RPC, so the
 * browser can't watch the chain itself; instead this server, which follows the chain anyway
 * (indexer.ts), pushes each new event to the people it involves. The stream only says "this
 * changed"; the browser then re-reads through the normal API, so nothing new is exposed here.
 */
import type { Response } from "express";

const streams = new Map<string, Set<Response>>();
const MAX_PER_USER = 6;
const HEARTBEAT_MS = 20_000;

/** Keep `res` open as an event stream for `address` until the browser goes away. */
export function openStream(address: string, res: Response) {
  const a = address.toLowerCase();
  let set = streams.get(a);
  if (!set) streams.set(a, (set = new Set()));
  if (set.size >= MAX_PER_USER) {
    // Too many tabs: close the oldest stream (it reconnects if it's still wanted).
    const oldest = set.values().next().value!;
    set.delete(oldest);
    oldest.end();
  }
  res.status(200);
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no"); // nginx: don't buffer, send each event as it comes
  res.flushHeaders();
  res.write("retry: 3000\n\n");
  set.add(res);
  const beat = setInterval(() => res.write(": ping\n\n"), HEARTBEAT_MS);
  res.on("close", () => {
    clearInterval(beat);
    set!.delete(res);
    if (!set!.size) streams.delete(a);
  });
}

/** Send `event` with `data` to every open stream for `address`. */
export function push(address: string, event: string, data: unknown) {
  const set = streams.get(address.toLowerCase());
  if (!set) return;
  const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of set) res.write(msg);
}

export function openStreams() {
  let n = 0;
  for (const s of streams.values()) n += s.size;
  return n;
}
