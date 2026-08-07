import { expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  assertCcusageVersion,
  group,
  normalizeRows,
  scanHomes,
} from "../src/index.js";

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
});
