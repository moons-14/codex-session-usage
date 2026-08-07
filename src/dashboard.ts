import {
  existsSync,
  lstatSync,
  mkdirSync,
  openSync,
  closeSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ccusageRows,
  group,
  jsonSessions,
  scanHomes,
  type Session,
  type Warning,
} from "./index.js";

const DEFAULT_PORT = 4242;
const REFRESH_MS = 4_000;
type State = {
  pid: number;
  port: number;
  token: string;
  startedAt: string;
  log: string;
};
export type Snapshot = {
  sessions: Session[];
  warnings: Warning[];
  refreshedAt: string;
  error?: string;
  scope: { since?: string; until?: string };
  totals: {
    tokens: number;
    costUSD: number;
    sessions: number;
    threads: number;
    unattributedCostUSD: number;
  };
};

function runtimeDir(): string {
  const candidate = process.env.XDG_RUNTIME_DIR;
  try {
    if (candidate && existsSync(candidate))
      return safeRuntimeDirectory(join(candidate, "codex-session-usage"));
  } catch {}
  const uid = typeof process.getuid === "function" ? process.getuid() : "user";
  return safeRuntimeDirectory(join(tmpdir(), `codex-session-usage-${uid}`));
}
function safeRuntimeDirectory(path: string): string {
  mkdirSync(path, { recursive: true, mode: 0o700 });
  const stat = lstatSync(path);
  if (!stat.isDirectory() || stat.isSymbolicLink())
    throw new Error(`Refusing unsafe dashboard runtime directory: ${path}`);
  if (typeof process.getuid === "function" && stat.uid !== process.getuid())
    throw new Error(
      `Dashboard runtime directory is not owned by this user: ${path}`,
    );
  if ((stat.mode & 0o077) !== 0)
    throw new Error(
      `Dashboard runtime directory must not be group/world accessible: ${path}`,
    );
  return path;
}
export function statePath() {
  return join(runtimeDir(), "dashboard.json");
}
export function logPath() {
  return join(runtimeDir(), "dashboard.log");
}
function safeLog(path: string) {
  try {
    const stat = lstatSync(path);
    if (stat.isSymbolicLink() || !stat.isFile())
      throw new Error(`Refusing unsafe dashboard log path: ${path}`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const fd = openSync(path, "a", 0o600);
  closeSync(fd);
}
function readState(): State | undefined {
  const path = statePath();
  try {
    const stat = lstatSync(path);
    if (!stat.isFile() || stat.isSymbolicLink()) return;
    const raw = JSON.parse(readFileSync(path, "utf8")) as State;
    return Number.isInteger(raw.pid) &&
      Number.isInteger(raw.port) &&
      typeof raw.token === "string"
      ? raw
      : undefined;
  } catch {
    return;
  }
}
function clearState() {
  try {
    const p = statePath();
    if (lstatSync(p).isFile() && !lstatSync(p).isSymbolicLink()) unlinkSync(p);
  } catch {}
}
function ensureStateSafe() {
  try {
    const stat = lstatSync(statePath());
    if (stat.isSymbolicLink() || !stat.isFile())
      throw new Error(`Refusing unsafe dashboard state path: ${statePath()}`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}
function writeState(state: State) {
  const path = statePath();
  ensureStateSafe();
  try {
    const stat = lstatSync(path);
    if (stat.isSymbolicLink() || !stat.isFile())
      throw new Error(`Refusing unsafe dashboard state path: ${path}`);
    unlinkSync(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  writeFileSync(path, JSON.stringify(state), { mode: 0o600, flag: "wx" });
}
function validPort(raw: string | undefined): number {
  if (raw === undefined) return DEFAULT_PORT;
  if (!/^\d+$/.test(raw) || Number(raw) < 1 || Number(raw) > 65535)
    throw new Error("--port must be an integer between 1 and 65535");
  return Number(raw);
}
export function parsePort(args: string[]): number {
  const index = args.indexOf("--port");
  if (index < 0) return DEFAULT_PORT;
  if (args.indexOf("--port", index + 1) >= 0)
    throw new Error("--port may be provided once");
  if (index === args.length - 1 || args[index + 1]?.startsWith("--"))
    throw new Error("--port requires a value");
  return validPort(args[index + 1]);
}
async function health(state: State): Promise<boolean> {
  try {
    const response = await fetch(`http://127.0.0.1:${state.port}/health`, {
      signal: AbortSignal.timeout(700),
    });
    const value = (await response.json()) as { token?: string };
    return response.ok && value.token === state.token;
  } catch {
    return false;
  }
}
async function terminate(child: Bun.Subprocess) {
  try {
    child.kill("SIGTERM");
  } catch {}
  await Promise.race([child.exited, Bun.sleep(2_000)]);
  if (child.exitCode === null) {
    try {
      child.kill("SIGKILL");
    } catch {}
    await Promise.race([child.exited, Bun.sleep(2_000)]);
  }
}
export async function startDashboard(
  port: number,
  script = process.argv[1]!,
): Promise<string> {
  const previous = readState();
  if (previous && (await health(previous))) {
    if (previous.port !== port)
      throw new Error(
        `Dashboard is already running at http://127.0.0.1:${previous.port}/ (stop it before using another port)`,
      );
    return `Dashboard already running: http://127.0.0.1:${port}/`;
  }
  clearState();
  ensureStateSafe();
  const token = crypto.randomUUID();
  const log = logPath();
  safeLog(log);
  const output = Bun.file(log);
  const child = Bun.spawn(
    [
      process.execPath,
      script,
      "__serve",
      "--port",
      String(port),
      "--token",
      token,
    ],
    {
      detached: true,
      stdout: output,
      stderr: output,
      stdin: "ignore",
      env: process.env,
    },
  );
  const pending: State = {
    pid: child.pid,
    port,
    token,
    startedAt: new Date().toISOString(),
    log,
  };
  try {
    writeState(pending);
    for (let attempt = 0; attempt < 300; attempt++) {
      await Bun.sleep(100);
      if (await health(pending)) {
        child.unref();
        return `Dashboard started: http://127.0.0.1:${port}/\nLog: ${log}`;
      }
    }
  } catch (error) {
    await terminate(child);
    clearState();
    throw error;
  }
  await terminate(child);
  clearState();
  throw new Error(
    `Dashboard could not bind http://127.0.0.1:${port}/ (the port may be in use). See ${log}`,
  );
}
export async function stopDashboard(): Promise<string> {
  const state = readState();
  if (!state) return "Dashboard is not running.";
  if (!(await health(state))) {
    clearState();
    return "Dashboard is not running (removed stale state).";
  }
  try {
    process.kill(state.pid, "SIGTERM");
  } catch {
    clearState();
    return "Dashboard is not running (removed stale state).";
  }
  for (let attempt = 0; attempt < 50; attempt++) {
    await Bun.sleep(100);
    if (!(await health(state))) break;
  }
  if (await health(state))
    throw new Error(
      `Dashboard is still running at http://127.0.0.1:${state.port}/; state was retained.`,
    );
  clearState();
  return "Dashboard stopped.";
}
export function createSnapshot(
  scope: { since?: string; until?: string } = {},
): Snapshot {
  const homes = (process.env.CODEX_HOME ?? `${process.env.HOME}/.codex`)
    .split(",")
    .filter(Boolean);
  const scanned = scanHomes(homes);
  const grouped = group(
    ccusageRows("ccusage", scope),
    scanned.metas,
    scanned.warnings,
  );
  const sessions = grouped.sessions;
  return {
    sessions: jsonSessions(sessions, true),
    warnings: grouped.warnings,
    refreshedAt: new Date().toISOString(),
    scope,
    totals: {
      tokens: sessions.reduce((n, s) => n + s.totals.totalTokens, 0),
      costUSD: sessions.reduce((n, s) => n + s.costUSD, 0),
      sessions: sessions.length,
      threads: sessions.reduce((n, s) => n + s.threadIds.length, 0),
      unattributedCostUSD: sessions.reduce(
        (n, s) => n + s.unattributedCostUSD,
        0,
      ),
    },
  };
}
export async function serveDashboard(
  port: number,
  token: string,
): Promise<void> {
  let snapshot: Snapshot;
  try {
    snapshot = createSnapshot();
  } catch (error) {
    snapshot = {
      sessions: [],
      warnings: [],
      refreshedAt: new Date().toISOString(),
      error: error instanceof Error ? error.message : String(error),
      scope: {},
      totals: {
        tokens: 0,
        costUSD: 0,
        sessions: 0,
        threads: 0,
        unattributedCostUSD: 0,
      },
    };
  }
  const clients = new Set<ReadableStreamDefaultController<Uint8Array>>();
  const encoder = new TextEncoder();
  let refreshing = false;
  const publish = () => {
    const data = encoder.encode(
      `event: snapshot\ndata: ${JSON.stringify(snapshot)}\n\n`,
    );
    for (const client of clients) {
      try {
        client.enqueue(data);
      } catch {
        clients.delete(client);
      }
    }
  };
  const refresh = () => {
    if (refreshing) return;
    refreshing = true;
    try {
      snapshot = createSnapshot(snapshot.scope);
      snapshot.error = undefined;
    } catch (error) {
      snapshot = {
        ...snapshot,
        error: error instanceof Error ? error.message : String(error),
        refreshedAt: new Date().toISOString(),
      };
    } finally {
      refreshing = false;
      publish();
    }
  };
  const timer = setInterval(refresh, REFRESH_MS);
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port,
    fetch(request) {
      const url = new URL(request.url);
      const secure = {
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
        "referrer-policy": "no-referrer",
        "x-frame-options": "DENY",
        "content-security-policy":
          "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
      };
      if (url.pathname === "/health")
        return Response.json({ ok: true, token }, { headers: secure });
      if (url.pathname === "/api/sessions")
        return Response.json(snapshot, { headers: secure });
      if (url.pathname === "/events") {
        let controller: ReadableStreamDefaultController<Uint8Array> | undefined;
        return new Response(
          new ReadableStream({
            start(value) {
              controller = value;
              clients.add(value);
              value.enqueue(
                encoder.encode(
                  `event: snapshot\ndata: ${JSON.stringify(snapshot)}\n\n`,
                ),
              );
            },
            cancel() {
              if (controller) clients.delete(controller);
            },
          }),
          {
            headers: {
              ...secure,
              "content-type": "text/event-stream",
              "cache-control": "no-cache",
              connection: "keep-alive",
            },
          },
        );
      }
      if (url.pathname === "/" || url.pathname === "/index.html")
        return new Response(HTML, {
          headers: { ...secure, "content-type": "text/html; charset=utf-8" },
        });
      return new Response("Not found", { status: 404, headers: secure });
    },
  });
  const close = () => {
    clearInterval(timer);
    for (const client of clients)
      try {
        client.close();
      } catch {}
    server.stop(true);
    const state = readState();
    if (state?.token === token) clearState();
    process.exit(0);
  };
  process.on("SIGTERM", close);
  process.on("SIGINT", close);
  console.log(`Dashboard listening on http://127.0.0.1:${server.port}/`);
  await new Promise<void>(() => {});
}

const HTML =
  dashboardHtml(String.raw`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Codex session usage</title><style>
:root{--ink:#172033;--muted:#657084;--line:#dce2ea;--card:#fff;--bg:#f6f8fb;--a:#335cdb;--b:#0f9d84;--c:#e68731;--d:#9456c9;--e:#c34672}*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:14px system-ui,sans-serif}header,main{max-width:1180px;margin:auto;padding:20px}header{display:flex;justify-content:space-between;gap:16px;align-items:center}.brand{font-weight:750;font-size:20px}.status{color:var(--muted)}.live{color:#087f5b;font-weight:700}.grid{display:grid;grid-template-columns:repeat(4,1fr);gap:12px}.card,.session,.drawer{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:16px}.metric{font-size:25px;font-weight:750;margin-top:6px}.charts{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin:16px 0}.bar{display:flex;height:12px;border-radius:6px;overflow:hidden;background:#edf0f4}.bar span{min-width:2px}.session{margin:12px 0;cursor:pointer}.session:hover{border-color:var(--a)}.row{display:flex;justify-content:space-between;gap:16px;flex-wrap:wrap}.models{display:flex;gap:8px;flex-wrap:wrap;margin-top:10px}.pill{border:1px solid var(--line);border-radius:999px;padding:4px 8px}.muted{color:var(--muted)}input,select,button{font:inherit;padding:8px;border:1px solid var(--line);border-radius:8px;background:#fff}#filters{display:flex;gap:8px;margin:18px 0}dialog{border:0;background:transparent;padding:12px;max-width:850px;width:calc(100% - 24px)}dialog::backdrop{background:#17203388}.drawer{max-height:90vh;overflow:auto}table{border-collapse:collapse;width:100%;margin-top:10px}td,th{padding:7px;text-align:right;border-bottom:1px solid var(--line)}td:first-child,th:first-child{text-align:left}.warning{background:#fff4dc;border:1px solid #efd398;border-radius:8px;padding:10px;margin:12px 0}@media(max-width:720px){.grid{grid-template-columns:repeat(2,1fr)}.charts{grid-template-columns:1fr}header{align-items:flex-start;flex-direction:column}}</style><body><header><div><div class="brand">Codex session usage</div><div class="status" id="scope">Loading local offline data…</div></div><div id="status" class="status">Connecting</div></header><main><div class="grid" id="kpis"></div><div id="warning"></div><div class="charts"><section class="card"><b>Session token ranking</b><p class="muted">Total tokens; each bar starts at zero.</p><div id="ranking"></div></section><section class="card"><b>Model composition</b><p class="muted">Model share of total tokens by session.</p><div id="composition"></div></section></div><div id="filters"><input id="search" placeholder="Search title or session ID"><select id="sort"><option value="activity">Last activity</option><option value="tokens">Most tokens</option><option value="cost">Highest cost</option></select></div><div id="sessions"><p class="muted">Loading…</p></div></main><dialog id="dialog"><div class="drawer"><button id="close">Close</button><div id="detail"></div></div></dialog><script>
let data={sessions:[]}, selected;const $=id=>document.getElementById(id),nf=new Intl.NumberFormat(),usd=new Intl.NumberFormat(undefined,{style:'currency',currency:'USD'});const text=(el,v)=>el.textContent=v??'';function esc(v){return String(v??'')};function modelPills(s){let d=document.createElement('div');d.className='models';for(const [m,t] of Object.entries(s.models)){let p=document.createElement('span');p.className='pill';text(p,m+' · '+nf.format(t.totalTokens)+(s.modelCostsUSD[m]!==undefined?' · '+usd.format(s.modelCostsUSD[m]):''));d.append(p)}return d}function render(){let ss=[...data.sessions],q=$('search').value.toLowerCase(),sort=$('sort').value;ss=ss.filter(s=>(s.title+s.sessionId).toLowerCase().includes(q));ss.sort((a,b)=>sort==='tokens'?b.totals.totalTokens-a.totals.totalTokens:sort==='cost'?b.costUSD-a.costUSD:(b.lastActivity||'').localeCompare(a.lastActivity||''));let t=data.totals||{},cards=[['Total tokens',nf.format(t.tokens||0)],['Estimated API cost',usd.format(t.costUSD||0)],['Sessions',nf.format(t.sessions||0)],['Agents / threads',nf.format(t.threads||0)]];$('kpis').replaceChildren(...cards.map(([a,b])=>{let x=document.createElement('div');x.className='card';x.innerHTML='<div class="muted"></div><div class="metric"></div>';text(x.firstChild,a);text(x.lastChild,b);return x}));text($('scope'),'Offline ccusage data · refreshed '+new Date(data.refreshedAt).toLocaleTimeString());text($('status'),data.error?'Refresh error':'● Live');$('status').className=data.error?'status':'live';let w=$('warning');w.replaceChildren();if(t.unattributedCostUSD){let x=document.createElement('div');x.className='warning';text(x,'$'+t.unattributedCostUSD.toFixed(2)+' is included in totals but not assigned to a model: those rollouts used multiple models.');w.append(x)}if(data.error){let x=document.createElement('div');x.className='warning';text(x,data.error);w.append(x)}let max=Math.max(1,...ss.map(s=>s.totals.totalTokens));let rank=$('ranking');rank.replaceChildren(...ss.slice(0,8).map(s=>{let x=document.createElement('div');x.style.margin='10px 0';let l=document.createElement('div');l.className='row';text(l,s.title||'Untitled');let n=document.createElement('span');text(n,nf.format(s.totals.totalTokens));l.append(n);let b=document.createElement('div');b.className='bar';let z=document.createElement('span');z.style.width=(100*s.totals.totalTokens/max)+'%';z.style.background='var(--a)';b.append(z);x.append(l,b);return x}));let comp=$('composition');comp.replaceChildren(...ss.slice(0,8).map(s=>{let x=document.createElement('div');x.style.margin='10px 0';let l=document.createElement('div');text(l,s.title||'Untitled');let b=document.createElement('div');b.className='bar';let colors=['var(--a)','var(--b)','var(--c)','var(--d)','var(--e)'];Object.entries(s.models).forEach(([m,t],i)=>{let z=document.createElement('span');z.title=m+' '+nf.format(t.totalTokens);z.style.width=(100*t.totalTokens/Math.max(1,s.totals.totalTokens))+'%';z.style.background=colors[i%5];b.append(z)});x.append(l,b);return x}));let list=$('sessions');list.replaceChildren(...ss.map(s=>{let x=document.createElement('article');x.className='session';x.tabIndex=0;x.setAttribute('role','button');let h=document.createElement('div');h.className='row';let title=document.createElement('b');text(title,s.title||'Untitled');let cost=document.createElement('b');text(cost,usd.format(s.costUSD));h.append(title,cost);let meta=document.createElement('div');meta.className='muted';text(meta,s.sessionId+' · '+s.threadIds.length+' threads · '+(s.subagentCount)+' subagents · '+nf.format(s.totals.totalTokens)+' tokens');x.append(h,meta,modelPills(s));x.onclick=()=>open(s);x.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();open(s)}};return x}));if(!ss.length)list.innerHTML='<p class="muted">No sessions match this filter.</p>'}function open(s){selected=s;let d=$('detail');d.replaceChildren();let h=document.createElement('h2');text(h,s.title||'Untitled');let p=document.createElement('p');p.className='muted';text(p,s.sessionId+' · Total '+nf.format(s.totals.totalTokens)+' tokens · '+usd.format(s.costUSD));d.append(h,p);for(const a of s.details||[]){let c=document.createElement('section');c.className='card';c.style.marginTop='12px';let name=document.createElement('b');text(name,(a.nickname||a.name||'Unnamed')+(a.isSubagent?' · subagent':' · root'));let info=document.createElement('p');info.className='muted';text(info,[a.role,a.path,a.source,a.threadId].filter(Boolean).join(' · '));c.append(name,info,modelPills(a));let note=document.createElement('p');note.className='muted';text(note,'Thread total: '+nf.format(a.totals.totalTokens)+' tokens · '+usd.format(a.costUSD)+(a.unattributedCostUSD?' · '+usd.format(a.unattributedCostUSD)+' model-unattributed':''));c.append(note);d.append(c)}$('dialog').showModal();$('close').focus()}$('close').onclick=()=>$('dialog').close();$('search').oninput=render;$('sort').onchange=render;function update(v){data=v;render()}fetch('/api/sessions').then(r=>r.json()).then(update).catch(e=>{data.error=e.message;render()});let es;function connect(){es=new EventSource('/events');es.addEventListener('snapshot',e=>update(JSON.parse(e.data)));es.onerror=()=>{text($('status'),'Reconnecting…');$('status').className='status';es.close();setTimeout(connect,1500)}}connect();</script></body></html>`);

function dashboardHtml(html: string): string {
  return html
    .replace(
      "(s.modelCostsUSD[m]!==undefined?' · '+usd.format(s.modelCostsUSD[m]):'')",
      "(s.modelCostsUSD[m]!==undefined?' · '+usd.format(s.modelCostsUSD[m]):(s.unattributedCostUSD?' · price unallocated':' · price unavailable'))",
    )
    .replace(
      "let max=Math.max(1,...ss.map(s=>s.totals.totalTokens));let rank=$('ranking');rank.replaceChildren(...ss.slice(0,8)",
      "let ranked=[...data.sessions].sort((a,b)=>b.totals.totalTokens-a.totals.totalTokens);let max=Math.max(1,...ranked.map(s=>s.totals.totalTokens));let rank=$('ranking');rank.replaceChildren(...ranked.slice(0,8)",
    )
    .replace(
      "x.append(l,b);return x}));let comp",
      "x.tabIndex=0;x.setAttribute('role','button');x.onclick=()=>open(s);x.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();open(s)}};x.append(l,b);return x}));let comp",
    )
    .replace(
      "z.title=m+' '+nf.format(t.totalTokens);",
      "z.title=m+' '+nf.format(t.totalTokens)+(s.modelCostsUSD[m]!==undefined?' '+usd.format(s.modelCostsUSD[m]):' price unallocated');z.setAttribute('aria-label',z.title);",
    )
    .replace(
      "b.append(z)});x.append(l,b);return x}));let list",
      "b.append(z)});let legend=document.createElement('div');legend.className='models';Object.entries(s.models).forEach(([m,t])=>{let p=document.createElement('span');p.className='pill';text(p,m+' · '+nf.format(t.totalTokens)+(s.modelCostsUSD[m]!==undefined?' · '+usd.format(s.modelCostsUSD[m]):' · price unallocated'));legend.append(p)});x.tabIndex=0;x.setAttribute('role','button');x.onclick=()=>open(s);x.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();open(s)}};x.append(l,b,legend);return x}));let list",
    );
}
