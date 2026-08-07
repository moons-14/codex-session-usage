#!/usr/bin/env bun
import { ccusageRows, group, render, scanHomes } from "./index.js";
const args = process.argv.slice(2);
const take = (name: string) => {
  const i = args.indexOf(name);
  return i < 0 ? undefined : args[i + 1];
};
if (args.includes("--help")) {
  console.log(
    "Usage: codex-session-usage [--json] [--session ID] [--since ISO] [--until ISO] [--details]",
  );
  process.exit(0);
}
try {
  const homes = (process.env.CODEX_HOME ?? `${process.env.HOME}/.codex`)
    .split(",")
    .filter(Boolean);
  const scanned = scanHomes(homes);
  let sessions = group(ccusageRows(), scanned.metas, scanned.warnings).sessions;
  const session = take("--session"),
    since = take("--since"),
    until = take("--until");
  sessions = sessions.filter(
    (s) =>
      (!session || s.sessionId === session) &&
      (!since || (s.lastActivity ?? "") >= since) &&
      (!until || (s.lastActivity ?? "") <= until),
  );
  console.log(
    args.includes("--json")
      ? JSON.stringify({ sessions }, null, 2)
      : render(sessions, args.includes("--details")),
  );
} catch (e) {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
}
