import { existsSync, lstatSync, readdirSync, readFileSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
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
  sessionKey?: string;
  absoluteKey: string;
  active: boolean;
  sessionId?: string;
  threadId?: string;
  parentId?: string;
  isSubagent: boolean;
  lastActivity?: string;
  title?: string;
};
export type Row = {
  file?: string;
  directory?: string;
  model: string;
  tokens: Tokens;
  lastActivity?: string;
  /** ccusage reports one cost for the whole rollout, not for each model. */
  costUSD?: number;
};
export type Session = {
  sessionId: string;
  title: string;
  rootThreadId?: string;
  threadIds: string[];
  subagentCount: number;
  lastActivity?: string;
  models: Record<string, Tokens>;
  totals: Tokens;
  costUSD: number;
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

const normalizePath = (path: string) => path.replaceAll("\\", "/");
const withoutJsonl = (path: string) =>
  path.endsWith(".jsonl") ? path.slice(0, -".jsonl".length) : path;
const pathKey = (path: string) => withoutJsonl(normalizePath(path));
const relativeKey = (file: string, root: string) => {
  const key = pathKey(relative(root, file));
  return key === ".." || key.startsWith("../") ? undefined : key;
};

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
  sessionRoot: string,
  active: boolean,
  titles: Map<string, string>,
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
          sessionKey: relativeKey(file, sessionRoot),
          absoluteKey: pathKey(file),
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
          title:
            titles.get(string(payload, "session_id", "sessionId") ?? "") ??
            titles.get(string(payload, "id", "thread_id", "threadId") ?? ""),
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
function sessionTitles(home: string, warnings: Warning[]): Map<string, string> {
  const titles = new Map<string, string>();
  const file = join(home, "session_index.jsonl");
  if (!existsSync(file)) return titles;
  let contents: string;
  try {
    contents = readFileSync(file, "utf8");
  } catch {
    warnings.push({
      code: "unreadable_session_index",
      message: `Cannot read session index: ${file}`,
    });
    return titles;
  }
  for (const line of contents.split("\n")) {
    if (!line.trim()) continue;
    try {
      const entry = JSON.parse(line) as Record<string, unknown>;
      const id = string(entry, "id");
      const title = string(entry, "thread_name");
      if (!id || !title) throw new Error("missing id or thread_name");
      // The index is append-only; a later valid record is authoritative.
      titles.set(id, title);
    } catch {
      warnings.push({
        code: "malformed_session_index",
        message: `Malformed session index entry: ${file}`,
      });
    }
  }
  return titles;
}
export function scanHomes(homes: string[]): {
  metas: Meta[];
  warnings: Warning[];
} {
  const warnings: Warning[] = [],
    metas: Meta[] = [];
  for (const raw of homes) {
    const home = resolve(raw);
    const titles = sessionTitles(home, warnings);
    const byPath = new Map<string, Meta>();
    for (const [dir, active] of [
      ["archived_sessions", false],
      ["sessions", true],
    ] as const)
      for (const file of filesAt(join(home, dir), warnings)) {
        const m = metadata(
          home,
          file,
          join(home, dir),
          active,
          titles,
          warnings,
        );
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
    const costUSD = value(row, "costUSD", "costUsd", "cost_usd");
    if (models && !Array.isArray(models))
      for (const [index, [model, usage]] of Object.entries(models).entries())
        out.push({
          file: string(row, "sessionFile", "session_file", "file", "path"),
          directory: string(row, "directory", "dir"),
          model,
          tokens: tokens(usage as Record<string, unknown>),
          lastActivity: string(row, "lastActivity", "last_activity"),
          // ccusage gives this once per rollout.  Do not multiply it when its
          // token payload is split into multiple model rows.
          costUSD: index === 0 ? costUSD : undefined,
        });
    else
      out.push({
        file: string(row, "sessionFile", "session_file", "file", "path"),
        directory: string(row, "directory", "dir"),
        model: string(row, "model") ?? "unknown",
        tokens: tokens(row),
        lastActivity: string(row, "lastActivity", "last_activity"),
        costUSD,
      });
  }
  return out;
}
function rowPathKey(row: Row): { absolute: boolean; key: string } | undefined {
  if (!row.file) return;
  const file = normalizePath(row.file);
  if (isAbsolute(file)) return { absolute: true, key: withoutJsonl(file) };
  if (!row.directory) return { absolute: false, key: withoutJsonl(file) };
  const directory = normalizePath(row.directory).replace(/\/+$/, "");
  const key = `${directory}/${file.replace(/^\/+/, "")}`;
  return isAbsolute(directory)
    ? { absolute: true, key: withoutJsonl(key) }
    : { absolute: false, key: withoutJsonl(key) };
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
  const byRelativePath = new Map<string, Meta[]>(),
    byAbsolutePath = new Map<string, Meta[]>();
  for (const meta of metas) {
    if (meta.sessionKey) {
      const matches = byRelativePath.get(meta.sessionKey) ?? [];
      matches.push(meta);
      byRelativePath.set(meta.sessionKey, matches);
    }
    const matches = byAbsolutePath.get(meta.absoluteKey) ?? [];
    matches.push(meta);
    byAbsolutePath.set(meta.absoluteKey, matches);
  }
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
        title: "Untitled",
        rootThreadId: undefined,
        threadIds: [],
        subagentCount: 0,
        models: {},
        totals: zero(),
        costUSD: 0,
        warnings: [],
        details: [],
      };
      grouped.set(key, s);
    }
    if (meta.threadId && !s.threadIds.includes(meta.threadId)) {
      s.threadIds.push(meta.threadId);
      if (meta.isSubagent) s.subagentCount++;
    }
    if (!meta.isSubagent && meta.threadId) {
      s.rootThreadId = meta.threadId;
      if (meta.title) s.title = meta.title;
    }
    return s;
  };
  for (const row of rows) {
    const rowKey = rowPathKey(row);
    const matches = rowKey
      ? ((rowKey.absolute ? byAbsolutePath : byRelativePath).get(rowKey.key) ??
        [])
      : [];
    if (matches.length === 0) {
      warnings.push({
        code: "unmatched_row",
        message: `No metadata matches ccusage row ${row.file ?? row.directory ?? "unknown"}`,
      });
      continue;
    }
    if (matches.length > 1) {
      warnings.push({
        code: "ambiguous_row",
        message: `Multiple metadata files match ccusage row ${row.file ?? row.directory ?? "unknown"}`,
      });
      continue;
    }
    const [meta] = matches;
    const s = ensure(meta);
    const model = (s.models[row.model] ??= zero());
    add(model, row.tokens);
    add(s.totals, row.tokens);
    s.costUSD += row.costUSD ?? 0;
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
export function ccusageArgs(range?: {
  since?: string;
  until?: string;
}): string[] {
  return [
    "codex",
    "session",
    "--json",
    "--offline",
    ...(range?.since ? ["--since", range.since] : []),
    ...(range?.until ? ["--until", range.until] : []),
  ];
}
export function ccusageRows(
  command = "ccusage",
  range?: { since?: string; until?: string },
): Row[] {
  const version = spawnSync(command, ["--version"], { encoding: "utf8" });
  if (version.error)
    throw new Error(`Cannot run ${command}: ${version.error.message}`);
  assertCcusageVersion(version.stdout + version.stderr);
  const run = spawnSync(command, ccusageArgs(range), { encoding: "utf8" });
  if (run.status !== 0) throw new Error(run.stderr || "ccusage failed");
  return normalizeRows(JSON.parse(run.stdout));
}
export function render(
  sessions: Session[],
  details = false,
  terminalWidth = process.stdout.columns ?? 120,
): string {
  const maxWidth = Math.max(terminalWidth, 1);
  const n = (x: number) => x.toLocaleString("en-US");
  const usd = (x: number) =>
    x.toLocaleString("en-US", { style: "currency", currency: "USD" });
  const lines: string[] = [];
  for (const s of sessions) {
    lines.push(sessionHeader(s, usd(s.costUSD), maxWidth));
    const rows = Object.entries(s.models).map(([model, t]) => ({
      MODEL: model,
      INPUT: n(t.inputTokens),
      CACHE: n(t.cacheReadTokens),
      OUTPUT: n(t.outputTokens),
      REASONING: n(t.reasoningOutputTokens),
      TOTAL: n(t.totalTokens),
    }));
    const t = s.totals;
    rows.push({
      MODEL: "TOTAL",
      INPUT: n(t.inputTokens),
      CACHE: n(t.cacheReadTokens),
      OUTPUT: n(t.outputTokens),
      REASONING: n(t.reasoningOutputTokens),
      TOTAL: n(t.totalTokens),
    });
    lines.push(responsiveTable(rows, maxWidth));
    if (details && s.details?.length) {
      lines.push(short("Details", maxWidth));
      lines.push(
        responsiveTable(
          s.details.map((d) => ({
            THREAD: d.threadId ?? "unknown",
            MODEL: d.model,
            INPUT: n(d.tokens.inputTokens),
            CACHE: n(d.tokens.cacheReadTokens),
            OUTPUT: n(d.tokens.outputTokens),
            REASONING: n(d.tokens.reasoningOutputTokens),
            TOTAL: n(d.tokens.totalTokens),
          })),
          maxWidth,
          true,
        ),
      );
    }
    lines.push("");
  }
  if (sessions.length) {
    lines.push(
      short(
        `Estimated total cost: ${usd(sessions.reduce((sum, s) => sum + s.costUSD, 0))}`,
        maxWidth,
      ),
    );
  }
  return lines.join("\n");
}
type DisplayRow = Record<string, string>;
const columnOrder = [
  "THREAD",
  "MODEL",
  "INPUT",
  "CACHE",
  "OUTPUT",
  "REASONING",
  "TOTAL",
];
const dropOrder = ["CACHE", "REASONING", "OUTPUT", "MODEL"];
const numeric = new Set(["INPUT", "CACHE", "OUTPUT", "REASONING", "TOTAL"]);

function sessionHeader(s: Session, cost: string, maxWidth: number): string {
  const id = short(safe(s.sessionId), 13);
  const suffix = ` (${id}, ${s.threadIds.length} threads, ${cost})`;
  if (Bun.stringWidth(suffix) >= maxWidth)
    return short(`${safe(s.title)} ${cost}`, maxWidth);
  return `${short(safe(s.title), maxWidth - Bun.stringWidth(suffix))}${suffix}`;
}
function safe(text: string): string {
  return text
    .replace(
      /\x1b(?:\][^\x07\x1b]*(?:\x07|\x1b\\)|[@-_][0-?]*[ -/]*[@-~])/g,
      "",
    )
    .replace(/[\x00-\x1f\x7f-\x9f]/g, "");
}
function short(text: string, max: number): string {
  if (Bun.stringWidth(text) <= max) return text;
  if (max <= 1) return "…".slice(0, max);
  const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
  let result = "";
  for (const { segment } of segmenter.segment(text)) {
    if (Bun.stringWidth(result + segment) > max - 1) break;
    result += segment;
  }
  return `${result}…`;
}
function responsiveTable(
  rows: DisplayRow[],
  maxWidth: number,
  details = false,
): string {
  const available = new Set(Object.keys(rows[0] ?? {}));
  const columns = columnOrder.filter((column) => available.has(column));
  for (const dropped of [undefined, ...dropOrder]) {
    if (dropped) available.delete(dropped);
    const selected = columns.filter((column) => available.has(column));
    const output = table(selected, rows, details, maxWidth);
    if (output) return output;
  }
  return rows
    .map((row) =>
      short(
        Object.entries(row)
          .map(([key, value]) => `${key.toLowerCase()}=${safe(value)}`)
          .join(" "),
        maxWidth,
      ),
    )
    .join("\n");
}
function table(
  headers: string[],
  rows: DisplayRow[],
  details: boolean,
  maxWidth: number,
): string | undefined {
  if (!headers.length) return;
  const normalized = [
    headers,
    ...rows.map((row) => headers.map((header) => safe(row[header] ?? ""))),
  ].map((row) =>
    row.map((cell, index) =>
      short(
        cell,
        headers[index] === "THREAD" || headers[index] === "MODEL" ? 24 : 14,
      ),
    ),
  );
  const widths = headers.map((_, index) =>
    Math.max(...normalized.map((row) => Bun.stringWidth(row[index]))),
  );
  const lineWidth = widths.reduce(
    (sum, size) => sum + size + 2,
    headers.length + 1,
  );
  if (lineWidth > maxWidth) return;
  const border = (left: string, middle: string, end: string, fill: string) =>
    left + widths.map((size) => fill.repeat(size + 2)).join(middle) + end;
  const line = (row: string[]) =>
    "│" +
    row
      .map((cell, index) => {
        const padding = " ".repeat(widths[index] - Bun.stringWidth(cell));
        return numeric.has(headers[index])
          ? ` ${padding}${cell} `
          : ` ${cell}${padding} `;
      })
      .join("│") +
    "│";
  return [
    border("┌", "┬", "┐", "─"),
    line(normalized[0]),
    border("├", "┼", "┤", "─"),
    ...normalized
      .slice(1)
      .flatMap((row, index) =>
        !details && index === normalized.length - 2
          ? [border("├", "┼", "┤", "─"), line(row)]
          : [line(row)],
      ),
    border("└", "┴", "┘", "─"),
  ].join("\n");
}
export function jsonSessions(sessions: Session[], details: boolean): Session[] {
  return sessions.map(({ details: rows, ...session }) =>
    details ? { ...session, details: rows } : session,
  );
}
