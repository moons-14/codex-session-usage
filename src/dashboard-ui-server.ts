import { createSnapshot, type Snapshot } from "./dashboard.js";
import { dashboardHtmlPart1 } from "./dashboard-ui-1.js";
import { dashboardHtmlPart2 } from "./dashboard-ui-2.js";
import { dashboardHtmlPart3 } from "./dashboard-ui-3.js";

const REFRESH_MS = 4_000;
const HTML = dashboardHtmlPart1 + dashboardHtmlPart2 + dashboardHtmlPart3;

export async function serveDashboardUi(port: number, token: string): Promise<void> {
  let snapshot: Snapshot;
  try {
    snapshot = createSnapshot();
  } catch (error) {
    snapshot = {
      sessions: [], warnings: [], refreshedAt: new Date().toISOString(),
      error: error instanceof Error ? error.message : String(error), scope: {},
      totals: { tokens: 0, costUSD: 0, sessions: 0, threads: 0, unattributedCostUSD: 0 },
    };
  }
  const clients = new Set<ReadableStreamDefaultController<Uint8Array>>();
  const encoder = new TextEncoder();
  let refreshing = false;
  const publish = () => {
    const payload = encoder.encode(`event: snapshot\ndata: ${JSON.stringify(snapshot)}\n\n`);
    for (const client of clients) {
      try { client.enqueue(payload); } catch { clients.delete(client); }
    }
  };
  const refresh = () => {
    if (refreshing) return;
    refreshing = true;
    try { snapshot = createSnapshot(snapshot.scope); snapshot.error = undefined; }
    catch (error) { snapshot = { ...snapshot, error: error instanceof Error ? error.message : String(error), refreshedAt: new Date().toISOString() }; }
    finally { refreshing = false; publish(); }
  };
  const timer = setInterval(refresh, REFRESH_MS);
  const secure = {
    "cache-control": "no-store", "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer", "x-frame-options": "DENY",
    "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  };
  const server = Bun.serve({
    hostname: "127.0.0.1", port,
    fetch(request) {
      const url = new URL(request.url);
      if (url.pathname === "/health") return Response.json({ ok: true, token }, { headers: secure });
      if (url.pathname === "/api/sessions") return Response.json(snapshot, { headers: secure });
      if (url.pathname === "/events") {
        let controller: ReadableStreamDefaultController<Uint8Array> | undefined;
        return new Response(new ReadableStream({
          start(value) { controller = value; clients.add(value); value.enqueue(encoder.encode(`event: snapshot\ndata: ${JSON.stringify(snapshot)}\n\n`)); },
          cancel() { if (controller) clients.delete(controller); },
        }), { headers: { ...secure, "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" } });
      }
      if (url.pathname === "/" || url.pathname === "/index.html") return new Response(HTML, { headers: { ...secure, "content-type": "text/html; charset=utf-8" } });
      return new Response("Not found", { status: 404, headers: secure });
    },
  });
  const close = () => {
    clearInterval(timer);
    for (const client of clients) try { client.close(); } catch {}
    server.stop(true); process.exit(0);
  };
  process.on("SIGTERM", close); process.on("SIGINT", close);
  console.log(`Dashboard listening on http://127.0.0.1:${server.port}/`);
  await new Promise<void>(() => {});
}
