import { existsSync, lstatSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

export type Tokens = Record<
  | "inputTokens"
  | "cacheReadTokens"
  | "outputTokens"
  | "reasoningOutputTokens"
  | "totalTokens",
  number
>;
export type Warning = { code: string; message: string };
type Meta = {
  home: string;
  file: string;
  active: boolean;
  sessionId?: string;
  threadId?: string;
  parentId?: string;
  isSubagent: boolean;
  lastActivity?: string;
};
type Row = {
  file?: string;
  directory?: string;
  model: string;
  tokens: Tokens;
  lastActivity?: string;
};
export type Session = {
  sessionId: string;
  rootThreadId?: string;
  threadIds: string[];
  subagentCount: number;
  lastActivity?: string;
  models: Record<string, Tokens>;
  totals: Tokens;
  warnings: Warning[];
  details?: Array<{ threadId?: string; model: string; tokens: Tokens }>;
};
const zero = (): Tokens => ({
  inputTokens: 0,
  cacheReadTokens: 0,
  outputTokens: 0,
  reasoningOutputTokens: 0,
  totalTokens: 0,
});
const add = (a: Tokens, b: Tokens) => {
  for (const k of Object.keys(a) as (keyof Tokens)[]) a[k] += b[k];
};
const value = (o: Record<string, unknown>, ...keys: string[]) =>
  keys.map((k) => o[k]).find((v) => typeof v === "number") as
    number | undefined;
const string = (o: Record<string, unknown>, ...keys: string[]) =>
  keys.map((k) => o[k]).find((v) => typeof v === "string") as
    string | undefined;

function filesAt(root: string, warnings: Warning[]): string[] {
  if (!existsSync(root)) return [];
  const result: string[] = [];
  let entries: string[];
  try {
    entries = readdirSync(root);
  } catch {
    warnings.push({
      code: "scan_error",
      message: `Cannot read directory: ${root}`,
    });
    return result;
  }
  for (const e of entries) {
    const p = join(root, e);
    let stat;
    try {
      stat = lstatSync(p);
    } catch {
      warnings.push({ code: "scan_error", message: `Cannot inspect: ${p}` });
      continue;
    }
    if (stat.isSymbolicLink()) {
      warnings.push({
        code: "symlink_skipped",
        message: `Skipped symlink: ${p}`,
      });
      continue;
    }
    if (stat.isDirectory()) result.push(...filesAt(p, warnings));
    else if (p.endsWith(".jsonl")) result.push(p);
  }
  return result;
}
function metadata(
  home: string,
  file: string,
  active: boolean,
  warnings: Warning[],
): Meta | undefined {
  try {
    for (const line of readFileSync(file, "utf8").split("\n")) {
      if (!line.trim()) continue;
      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(line);
      } catch {
        warnings.push({
          code: "malformed_metadata",
          message: `Malformed JSONL: ${file}`,
        });
        return;
      }
      const payload = parsed.payload as Record<string, unknown> | undefined;
      if (
        (parsed.type === "session_meta" ||
          parsed.type === "session_metadata") &&
        payload &&
        typeof payload === "object"
      ) {
        const source = payload.source as Record<string, unknown> | undefined;
        const subagent = source?.subagent as
          Record<string, unknown> | undefined;
        const spawn = subagent?.thread_spawn as
          Record<string, unknown> | undefined;
        return {
          home,
          file,
          active,
          sessionId: string(payload, "session_id", "sessionId"),
          threadId: string(payload, "id", "thread_id", "threadId"),
          parentId:
            string(payload, "parent_thread_id", "parentThreadId") ??
            (spawn && string(spawn, "parent_thread_id", "parentThreadId")),
          isSubagent: Boolean(
            payload.parent_thread_id || payload.parentThreadId || spawn,
          ),
          lastActivity: string(payload, "last_activity", "lastActivity"),
        };
      }
    }
    warnings.push({
      code: "missing_metadata",
      message: `No session_meta found: ${file}`,
    });
  } catch {
    warnings.push({
      code: "unreadable_metadata",
      message: `Cannot read metadata: ${file}`,
    });
  }
}
export function scanHomes(homes: string[]): {
  metas: Meta[];
  warnings: Warning[];
} {
  const warnings: Warning[] = [],
    metas: Meta[] = [];
  for (const raw of homes) {
    const home = resolve(raw);
    const byPath = new Map<string, Meta>();
    for (const [dir, active] of [
      ["archived_sessions", false],
      ["sessions", true],
    ] as const)
      for (const file of filesAt(join(home, dir), warnings)) {
        const m = metadata(home, file, active, warnings);
        if (!m) continue;
        const relative = file.slice(join(home, dir).length);
        const old = byPath.get(relative);
        if (!old || m.active) byPath.set(relative, m);
      }
    metas.push(...byPath.values());
  }
  return { metas, warnings };
}
function tokens(raw: Record<string, unknown>): Tokens {
  const usage = (raw.usage ?? raw.tokens ?? raw) as Record<string, unknown>;
  return {
    inputTokens:
      value(
        usage,
        "inputTokens",
        "input_tokens",
        "nonCachedInputTokens",
        "non_cached_input_tokens",
      ) ?? 0,
    cacheReadTokens:
      value(
        usage,
        "cacheReadTokens",
        "cache_read_tokens",
        "cacheCreationInputTokens",
        "cache_creation_input_tokens",
      ) ?? 0,
    outputTokens: value(usage, "outputTokens", "output_tokens") ?? 0,
    reasoningOutputTokens:
      value(usage, "reasoningOutputTokens", "reasoning_output_tokens") ?? 0,
    totalTokens: value(usage, "totalTokens", "total_tokens") ?? 0,
  };
}
export function normalizeRows(raw: unknown): Row[] {
  const list = Array.isArray(raw)
    ? raw
    : ((raw as Record<string, unknown>).sessions ??
      (raw as Record<string, unknown>).data ??
      []);
  if (!Array.isArray(list)) throw new Error("ccusage JSON has no session rows");
  const out: Row[] = [];
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const models = row.models as Record<string, unknown> | undefined;
    if (models && !Array.isArray(models))
      for (const [model, usage] of Object.entries(models))
        out.push({
          file: string(row, "sessionFile", "session_file", "file", "path"),
          directory: string(row, "directory", "dir"),
          model,
          tokens: tokens(usage as Record<string, unknown>),
          lastActivity: string(row, "lastActivity", "last_activity"),
        });
    else
      out.push({
        file: string(row, "sessionFile", "session_file", "file", "path"),
        directory: string(row, "directory", "dir"),
        model: string(row, "model") ?? "unknown",
        tokens: tokens(row),
        lastActivity: string(row, "lastActivity", "last_activity"),
      });
  }
  return out;
}
function samePath(row: Row, meta: Meta): boolean {
  const f = row.file && resolve(row.file);
  return (
    f === meta.file ||
    (!!row.directory && meta.file.startsWith(resolve(row.directory) + "/")) ||
    (!!row.file && meta.file.endsWith("/" + row.file))
  );
}
export function group(
  rows: Row[],
  metas: Meta[],
  initialWarnings: Warning[] = [],
): { sessions: Session[]; warnings: Warning[] } {
  const warnings = [...initialWarnings],
    byThread = new Map(
      metas
        .filter((m) => m.threadId)
        .map((m) => [`${m.home}:${m.threadId}`, m]),
    );
  const tree = (m: Meta): string => {
    if (m.sessionId) return m.sessionId;
    if (!m.threadId) {
      warnings.push({
        code: "missing_thread",
        message: `No thread ID: ${m.file}`,
      });
      return `unknown:${m.file}`;
    }
    let cur = m,
      seen = new Set<string>();
    while (cur.isSubagent && cur.parentId) {
      const key = `${cur.home}:${cur.threadId}`;
      if (seen.has(key)) {
        warnings.push({
          code: "parent_cycle",
          message: `Parent cycle at ${m.file}`,
        });
        return m.threadId;
      }
      seen.add(key);
      const parent = byThread.get(`${cur.home}:${cur.parentId}`);
      if (!parent) {
        warnings.push({
          code: "missing_parent",
          message: `Missing parent ${cur.parentId} for ${m.file}`,
        });
        return m.threadId;
      }
      cur = parent;
    }
    return cur.threadId!;
  };
  const grouped = new Map<string, Session>();
  const ensure = (meta: Meta) => {
    const id = tree(meta),
      key = `${meta.home}:${id}`;
    let s = grouped.get(key);
    if (!s) {
      s = {
        sessionId: id,
        rootThreadId: undefined,
        threadIds: [],
        subagentCount: 0,
        models: {},
        totals: zero(),
        warnings: [],
        details: [],
      };
      grouped.set(key, s);
    }
    if (meta.threadId && !s.threadIds.includes(meta.threadId)) {
      s.threadIds.push(meta.threadId);
      if (meta.isSubagent) s.subagentCount++;
    }
    if (!meta.isSubagent && meta.threadId) s.rootThreadId = meta.threadId;
    return s;
  };
  for (const row of rows) {
    const meta = metas.find((m) => samePath(row, m));
    if (!meta) {
      warnings.push({
        code: "unmatched_row",
        message: `No metadata matches ccusage row ${row.file ?? row.directory ?? "unknown"}`,
      });
      continue;
    }
    const s = ensure(meta);
    const model = (s.models[row.model] ??= zero());
    add(model, row.tokens);
    add(s.totals, row.tokens);
    s.details!.push({
      threadId: meta.threadId,
      model: row.model,
      tokens: row.tokens,
    });
    if (
      !s.lastActivity ||
      (row.lastActivity && row.lastActivity > s.lastActivity)
    )
      s.lastActivity = row.lastActivity;
  }
  // ccusage decides the date scope.  Enrich only trees it selected, so a
  // metadata-only historical session cannot reappear after filtering.
  for (const meta of metas) {
    const id = tree(meta);
    if (grouped.has(`${meta.home}:${id}`)) ensure(meta);
  }
  for (const s of grouped.values())
    s.warnings = warnings.filter((w) =>
      s.threadIds.some((id) => w.message.includes(id)),
    );
  return {
    sessions: [...grouped.values()].sort((a, b) =>
      (b.lastActivity ?? "").localeCompare(a.lastActivity ?? ""),
    ),
    warnings,
  };
}
export function assertCcusageVersion(version: string): void {
  const m = version.match(/(\d+)\.(\d+)\.(\d+)/);
  const found = m?.slice(1).map(Number);
  if (
    !found ||
    found[0] < 20 ||
    (found[0] === 20 && (found[1] < 0 || (found[1] === 0 && found[2] < 19)))
  )
    throw new Error(
      `ccusage >= 20.0.19 is required (found ${version || "unknown"})`,
    );
}
export function ccusageRows(
  command = "ccusage",
  range?: { since?: string; until?: string },
): Row[] {
  const version = spawnSync(command, ["--version"], { encoding: "utf8" });
  if (version.error)
    throw new Error(`Cannot run ${command}: ${version.error.message}`);
  assertCcusageVersion(version.stdout + version.stderr);
  const run = spawnSync(
    command,
    [
      "codex",
      "session",
      "--json",
      "--offline",
      "--no-cost",
      ...(range?.since ? ["--since", range.since] : []),
      ...(range?.until ? ["--until", range.until] : []),
    ],
    { encoding: "utf8" },
  );
  if (run.status !== 0) throw new Error(run.stderr || "ccusage failed");
  return normalizeRows(JSON.parse(run.stdout));
}
export function render(sessions: Session[], details = false): string {
  const head =
    "SESSION\tTHREADS\tMODEL\tINPUT\tCACHE\tOUTPUT\tREASONING\tTOTAL";
  const n = (x: number) => x.toLocaleString("en-US");
  const lines = [head];
  for (const s of sessions) {
    for (const [model, t] of Object.entries(s.models))
      lines.push(
        `${s.sessionId}\t${s.threadIds.length}\t${model}\t${n(t.inputTokens)}\t${n(t.cacheReadTokens)}\t${n(t.outputTokens)}\t${n(t.reasoningOutputTokens)}\t${n(t.totalTokens)}`,
      );
    const t = s.totals;
    lines.push(
      `${s.sessionId}\t${s.threadIds.length}\tTOTAL\t${n(t.inputTokens)}\t${n(t.cacheReadTokens)}\t${n(t.outputTokens)}\t${n(t.reasoningOutputTokens)}\t${n(t.totalTokens)}`,
    );
    if (details)
      for (const d of s.details ?? [])
        lines.push(
          `  ${d.threadId ?? "unknown"}\t\t${d.model}\t${n(d.tokens.inputTokens)}\t${n(d.tokens.cacheReadTokens)}\t${n(d.tokens.outputTokens)}\t${n(d.tokens.reasoningOutputTokens)}\t${n(d.tokens.totalTokens)}`,
        );
  }
  return lines.join("\n");
}
export function jsonSessions(sessions: Session[], details: boolean): Session[] {
  return sessions.map(({ details: rows, ...session }) =>
    details ? { ...session, details: rows } : session,
  );
}
