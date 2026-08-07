#!/usr/bin/env bun
import {
  ccusageRows,
  group,
  jsonSessions,
  render,
  scanHomes,
} from "./index.js";
import {
  parsePort,
  serveDashboard,
  startDashboard,
  stopDashboard,
} from "./dashboard.js";
const args = process.argv.slice(2);
const command = args[0];
if (command === "start" || command === "stop" || command === "__serve") {
  try {
    if (command === "start")
      console.log(await startDashboard(parsePort(args.slice(1))));
    else if (command === "stop") console.log(await stopDashboard());
    else {
      const port = parsePort(args.slice(1));
      const tokenIndex = args.indexOf("--token");
      const token = tokenIndex >= 0 ? args[tokenIndex + 1] : undefined;
      if (!token) throw new Error("internal server requires --token");
      await serveDashboard(port, token);
    }
  } catch (e) {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  }
} else {
  const take = (name: string) => {
    const i = args.indexOf(name);
    return i < 0 ? undefined : args[i + 1];
  };
  const option = (name: string) => {
    const value = take(name);
    if (args.includes(name) && (!value || value.startsWith("--")))
      throw new Error(`${name} requires a value`);
    if (
      value &&
      name !== "--session" &&
      !/^(\d{4}-\d{2}-\d{2}|\d{8})$/.test(value)
    )
      throw new Error(`${name} must be YYYY-MM-DD or YYYYMMDD`);
    return value;
  };
  if (args.includes("--help")) {
    console.log(
      "Usage: codex-session-usage [--json] [--session ID] [--since ISO] [--until ISO] [--details]\n       codex-session-usage start [--port PORT]\n       codex-session-usage stop",
    );
    process.exit(0);
  }
  try {
    const homes = (process.env.CODEX_HOME ?? `${process.env.HOME}/.codex`)
      .split(",")
      .filter(Boolean);
    const session = option("--session"),
      since = option("--since"),
      until = option("--until");
    const scanned = scanHomes(homes);
    const grouped = group(
      ccusageRows("ccusage", { since, until }),
      scanned.metas,
      scanned.warnings,
    );
    let sessions = grouped.sessions;
    sessions = sessions.filter((s) => !session || s.sessionId === session);
    console.log(
      args.includes("--json")
        ? JSON.stringify(
            {
              sessions: jsonSessions(sessions, args.includes("--details")),
              warnings: grouped.warnings,
            },
            null,
            2,
          )
        : render(sessions, args.includes("--details")),
    );
    if (!args.includes("--json"))
      for (const warning of grouped.warnings)
        console.error(`warning [${warning.code}]: ${warning.message}`);
  } catch (e) {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  }
}
