import { expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  assertCcusageVersion,
  ccusageArgs,
  group,
  jsonSessions,
  normalizeRows,
  render,
  scanHomes,
} from "../src/index.js";
import {
  dashboardDocument,
  parsePort,
  pidAlive,
  validState,
} from "../src/dashboard.js";

const home = () => {
  const p = join(tmpdir(), `csu-${crypto.randomUUID()}`);
  mkdirSync(join(p, "sessions"), { recursive: true });
  return p;
};
const meta = (payload: object) =>
  JSON.stringify({ type: "session_meta", payload }) + "\n";
const row = (file: string, model = "gpt", total = 10) => ({
  sessionFile: file,
  models: {
    [model]: {
      inputTokens: 2,
      cacheReadTokens: 3,
      outputTokens: 4,
      reasoningOutputTokens: 1,
      totalTokens: total,
    },
  },
  lastActivity: "2026-08-07T12:00:00Z",
});
test("groups explicit session IDs, nested subagents, and model totals", () => {
  const h = home(),
    a = join(h, "sessions", "a.jsonl"),
    b = join(h, "sessions", "b.jsonl");
  writeFileSync(a, meta({ session_id: "S", id: "root" }));
  writeFileSync(
    b,
    meta({ session_id: "S", id: "child", parent_thread_id: "root" }),
  );
  const s = scanHomes([h]);
  const out = group(
    normalizeRows([row(a, "one", 10), row(b, "two", 20)]),
    s.metas,
    s.warnings,
  ).sessions[0];
  expect(out.sessionId).toBe("S");
  expect(out.threadIds).toEqual(["root", "child"]);
  expect(out.subagentCount).toBe(1);
  expect(out.totals.totalTokens).toBe(30);
});
test("legacy confirmed subagents follow parents but forks remain separate", () => {
  const h = home(),
    a = join(h, "sessions", "a.jsonl"),
    b = join(h, "sessions", "b.jsonl"),
    f = join(h, "sessions", "fork.jsonl");
  writeFileSync(a, meta({ id: "root" }));
  writeFileSync(
    b,
    meta({
      id: "child",
      source: { subagent: { thread_spawn: { parent_thread_id: "root" } } },
    }),
  );
  writeFileSync(f, meta({ id: "fork", forked_from_id: "root" }));
  const s = scanHomes([h]);
  const out = group(
    normalizeRows([row(a), row(b), row(f)]),
    s.metas,
    s.warnings,
  ).sessions;
  expect(out.map((x) => x.sessionId).sort()).toEqual(["fork", "root"]);
  expect(out.find((x) => x.sessionId === "root")?.totals.totalTokens).toBe(20);
});
test("active rollout wins archived duplicate and invalid lineage warns", () => {
  const h = home(),
    active = join(h, "sessions", "x.jsonl"),
    archived = join(h, "archived_sessions", "x.jsonl");
  mkdirSync(join(h, "archived_sessions"), { recursive: true });
  writeFileSync(active, meta({ session_id: "active", id: "a" }));
  writeFileSync(archived, meta({ session_id: "archive", id: "a" }));
  const s = scanHomes([h]);
  expect(s.metas).toHaveLength(1);
  expect(s.metas[0].sessionId).toBe("active");
});
test("warns about malformed metadata and legacy parent cycles", () => {
  const h = home(),
    a = join(h, "sessions", "a.jsonl"),
    b = join(h, "sessions", "b.jsonl"),
    bad = join(h, "sessions", "bad.jsonl");
  writeFileSync(
    a,
    meta({
      id: "a",
      source: { subagent: { thread_spawn: { parent_thread_id: "b" } } },
    }),
  );
  writeFileSync(
    b,
    meta({
      id: "b",
      source: { subagent: { thread_spawn: { parent_thread_id: "a" } } },
    }),
  );
  writeFileSync(bad, "not json\n");
  const s = scanHomes([h]);
  const out = group(normalizeRows([row(a), row(b)]), s.metas, s.warnings);
  expect(out.warnings.map((w) => w.code)).toContain("malformed_metadata");
  expect(out.warnings.map((w) => w.code)).toContain("parent_cycle");
});
test("keeps colliding sessions in separate CODEX_HOME identities", () => {
  const one = home(),
    two = home(),
    a = join(one, "sessions", "a.jsonl"),
    b = join(two, "sessions", "b.jsonl");
  writeFileSync(a, meta({ session_id: "same", id: "a" }));
  writeFileSync(b, meta({ session_id: "same", id: "b" }));
  const s = scanHomes([one, two]);
  expect(
    group(normalizeRows([row(a), row(b)]), s.metas, s.warnings).sessions,
  ).toHaveLength(2);
});
test("normalizes ccusage model fields and enforces minimum version", () => {
  const r = normalizeRows([
    {
      models: {
        m: {
          inputTokens: 1,
          cacheReadTokens: 2,
          outputTokens: 3,
          reasoningOutputTokens: 1,
          totalTokens: 6,
        },
      },
    },
  ])[0];
  expect(r.tokens).toEqual({
    inputTokens: 1,
    cacheReadTokens: 2,
    outputTokens: 3,
    reasoningOutputTokens: 1,
    totalTokens: 6,
  });
  expect(() => assertCcusageVersion("ccusage 20.0.18")).toThrow();
  expect(() => assertCcusageVersion("20.0.19")).not.toThrow();
  expect(ccusageArgs()).not.toContain("--no-cost");
});
test("counts a rollout cost exactly once when ccusage expands its models", () => {
  const h = home(),
    file = join(h, "sessions", "a.jsonl");
  writeFileSync(file, meta({ session_id: "S", id: "root" }));
  const rows = normalizeRows([
    {
      ...row(file),
      costUSD: 1.25,
      models: { one: row(file).models.gpt, two: row(file).models.gpt },
    },
    { ...row(file, "three"), costUSD: 2.5 },
  ]);
  expect(rows.map((entry) => entry.costUSD)).toEqual([1.25, undefined, 2.5]);
  const scan = scanHomes([h]);
  expect(group(rows, scan.metas, scan.warnings).sessions[0].costUSD).toBe(3.75);
  const session = group(rows, scan.metas, scan.warnings).sessions[0];
  expect(session.modelCostsUSD.three).toBe(2.5);
  expect(session.unattributedCostUSD).toBe(1.25);
});
test("exposes current agent metadata in aggregated details", () => {
  const h = home(),
    file = join(h, "sessions", "agent.jsonl");
  writeFileSync(
    file,
    meta({
      session_id: "S",
      id: "agent",
      parent_thread_id: "root",
      agent_nickname: "Scout",
      agent_role: "explorer",
      agent_path: "root/scout",
      thread_source: "subagent",
    }),
  );
  const scan = scanHomes([h]);
  const detail = group(normalizeRows([row(file)]), scan.metas, scan.warnings)
    .sessions[0].details?.[0];
  expect(detail?.nickname).toBe("Scout");
  expect(detail?.role).toBe("explorer");
  expect(detail?.path).toBe("root/scout");
  expect(detail?.isSubagent).toBe(true);
});
test("validates dashboard ports", () => {
  expect(parsePort([])).toBe(4242);
  expect(parsePort(["--port", "49152"])).toBe(49152);
  expect(() => parsePort(["--port", "0"])).toThrow();
  expect(() => parsePort(["--port", "abc"])).toThrow();
  expect(() => parsePort(["--port"])).toThrow();
});
test("serves final dashboard markup without a template transform", () => {
  const document = dashboardDocument();
  for (const marker of [
    "price unallocated",
    "price unavailable",
    "let ranked=[...data.sessions]",
    "setAttribute('aria-label',z.title)",
    "x.onclick=()=>open(s)",
    "let legend=document.createElement('div')",
  ])
    expect(document).toContain(marker);
  expect(document).not.toContain("dashboardHtml");
});
test("dashboard PID liveness does not treat this process as stale", () => {
  expect(pidAlive(process.pid)).toBe(true);
  expect(pidAlive(999_999_999)).toBe(false);
});
test("rejects unsafe dashboard state before process operations", () => {
  const good = {
    pid: 12,
    port: 4242,
    token: "123e4567-e89b-42d3-a456-426614174000",
    startedAt: "now",
    log: "log",
  };
  expect(validState(good)).toBe(true);
  for (const bad of [
    { ...good, pid: 0 },
    { ...good, pid: -1 },
    { ...good, pid: Number.MAX_SAFE_INTEGER + 1 },
    { ...good, port: 0 },
    { ...good, port: 65536 },
    { ...good, token: "nope" },
  ])
    expect(validState(bad)).toBe(false);
});
test("uses the last valid root title from session_index and ignores child titles", () => {
  const h = home(),
    root = join(h, "sessions", "root.jsonl"),
    child = join(h, "sessions", "child.jsonl");
  writeFileSync(root, meta({ session_id: "S", id: "root" }));
  writeFileSync(
    child,
    meta({ session_id: "S", id: "child", parent_thread_id: "root" }),
  );
  writeFileSync(
    join(h, "session_index.jsonl"),
    [
      JSON.stringify({ id: "S", thread_name: "old" }),
      "not json",
      JSON.stringify({ id: "child", thread_name: "child title" }),
      JSON.stringify({ id: "S", thread_name: "日本語の最終タイトル" }),
    ].join("\n"),
  );
  const scan = scanHomes([h]);
  const output = group(
    normalizeRows([row(root), row(child)]),
    scan.metas,
    scan.warnings,
  );
  const session = output.sessions[0];
  expect(session.title).toBe("日本語の最終タイトル");
  expect(output.warnings.map((warning) => warning.code)).toContain(
    "malformed_session_index",
  );
});
test("matches ccusage relative directory and extensionless sessionFile", () => {
  const h = home();
  const file = join(
    h,
    "sessions",
    "2026",
    "08",
    "08",
    "rollout-2026-08-08T02-52-54-019fdd5b-4501-7a03-b0bb-24f2b2fd3780.jsonl",
  );
  mkdirSync(join(h, "sessions", "2026", "08", "08"), { recursive: true });
  writeFileSync(file, meta({ session_id: "S", id: "root" }));
  const scan = scanHomes([h]);
  const out = group(
    normalizeRows([
      {
        ...row(
          "rollout-2026-08-08T02-52-54-019fdd5b-4501-7a03-b0bb-24f2b2fd3780",
        ),
        directory: "2026/08/08",
      },
    ]),
    scan.metas,
    scan.warnings,
  );
  expect(out.sessions).toHaveLength(1);
  expect(out.sessions[0].sessionId).toBe("S");
  expect(out.warnings.map((warning) => warning.code)).not.toContain(
    "unmatched_row",
  );
});
test("matches an absolute sessionFile without its final jsonl extension", () => {
  const h = home(),
    file = join(h, "sessions", "a.jsonl");
  writeFileSync(file, meta({ session_id: "S", id: "root" }));
  const scan = scanHomes([h]);
  expect(
    group(
      normalizeRows([row(file.slice(0, -".jsonl".length))]),
      scan.metas,
      scan.warnings,
    ).sessions,
  ).toHaveLength(1);
});
test("does not attribute a relative ccusage row shared by multiple homes", () => {
  const one = home(),
    two = home();
  for (const h of [one, two]) {
    const dir = join(h, "sessions", "2026", "08", "08");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "same.jsonl"), meta({ session_id: h, id: "root" }));
  }
  const scan = scanHomes([one, two]);
  const out = group(
    normalizeRows([{ ...row("same"), directory: "2026/08/08" }]),
    scan.metas,
    scan.warnings,
  );
  expect(out.sessions).toHaveLength(0);
  expect(out.warnings.map((warning) => warning.code)).toContain(
    "ambiguous_row",
  );
});
test("keeps a zero-usage root and gates JSON details", () => {
  const h = home(),
    root = join(h, "sessions", "root.jsonl"),
    child = join(h, "sessions", "child.jsonl");
  writeFileSync(root, meta({ session_id: "S", id: "root" }));
  writeFileSync(
    child,
    meta({ session_id: "S", id: "child", parent_thread_id: "root" }),
  );
  const scan = scanHomes([h]),
    session = group(normalizeRows([row(child)]), scan.metas, scan.warnings)
      .sessions[0];
  expect(session.rootThreadId).toBe("root");
  expect(jsonSessions([session], false)[0].details).toBeUndefined();
  expect(jsonSessions([session], true)[0].details).toHaveLength(2);
  const displayed = render([
    { ...session, title: "日本語のとても長いタイトル" },
  ]);
  expect(displayed).toContain("┌");
  expect(displayed).toContain("┘");
  expect(displayed).toContain("日本語のとても長いタイトル");
  expect(displayed).toContain("TOTAL");
  expect(displayed).toContain("$0.00");
  expect(displayed).not.toContain("\t");
});
test("renders sanitized grapheme-safe tables within narrow terminal widths", () => {
  const h = home(),
    root = join(h, "sessions", "root.jsonl"),
    child = join(h, "sessions", "child.jsonl");
  writeFileSync(root, meta({ session_id: "S", id: "root" }));
  writeFileSync(
    child,
    meta({ session_id: "S", id: "child", parent_thread_id: "root" }),
  );
  const scan = scanHomes([h]);
  const session = group(
    normalizeRows([row(root, "gpt-5.6-sol", 12_345_678), row(child)]),
    scan.metas,
    scan.warnings,
  ).sessions[0];
  const family = "👨‍👩‍👧‍👦";
  const rawTitle = `${family.repeat(10)} e\u0301\n\x1b[31mnot-red\x1b[0m`;
  const titled = { ...session, title: rawTitle };
  expect(jsonSessions([titled], false)[0].title).toBe(rawTitle);
  for (const terminalWidth of [80, 50]) {
    const displayed = render([titled], true, terminalWidth);
    for (const line of displayed.split("\n"))
      expect(Bun.stringWidth(line)).toBeLessThanOrEqual(terminalWidth);
    expect(displayed).not.toContain("\x1b");
    expect(displayed).not.toContain("not-red\n");
    expect(displayed).toContain("e\u0301");
    expect(displayed.replaceAll(family, "")).not.toContain("\u200d");
  }
});
test("does not emit metadata-only trees outside ccusage selection", () => {
  const h = home(),
    a = join(h, "sessions", "a.jsonl"),
    b = join(h, "sessions", "b.jsonl");
  writeFileSync(a, meta({ session_id: "A", id: "a" }));
  writeFileSync(b, meta({ session_id: "B", id: "b" }));
  const scan = scanHomes([h]);
  expect(group([], scan.metas, scan.warnings).sessions).toHaveLength(0);
  expect(
    group(normalizeRows([row(a)]), scan.metas, scan.warnings).sessions.map(
      (s) => s.sessionId,
    ),
  ).toEqual(["A"]);
});
