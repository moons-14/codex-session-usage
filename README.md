# codex-session-usage

Offline CLI that aggregates a Codex root thread and its descendant subagents by model. It delegates token parsing and replay-deduplication to `ccusage`, then reads only the first canonical `session_meta` in each local rollout.

## Bun

```sh
bun install
bun run src/cli.ts
# or
bun run start -- --session <session-id> --details
```

`ccusage` **20.0.19 or newer** must be on `PATH`. The wrapper runs `ccusage codex session --json --offline`, so no network request is made. `CODEX_HOME` can contain comma-separated homes; both `sessions` and `archived_sessions` are scanned, with active files preferred.

Options: `--json`, `--session ID`, `--since ISO-8601`, `--until ISO-8601`, and `--details`.

Human output is one compact bordered table per root session: its sanitized header shows the root title from `$CODEX_HOME/session_index.jsonl`, a shortened session ID, and the session-level estimated cost. The title index is optional; its last valid record for an ID wins, and missing titles display as `Untitled`. The table responds to terminal width by omitting lower-priority `CACHE` and then `REASONING` columns when necessary; `--details` adapts the same way. `--json` retains the full, unsanitized title and ID and adds `title` and `costUSD`.

The cost is ccusage/LiteLLM's API-equivalent USD estimate. It is not a ChatGPT subscription charge, quota, or invoice. ccusage's Codex adapter v20.0.19 exposes a cost only for an entire rollout, not for its individual models, so prices appear in the session header and overall summary rather than being invented for model rows.

Current logs group by `payload.session_id`. Legacy logs follow `parent_thread_id` only when metadata confirms a subagent; `forked_from_id` is never followed. Missing parents, cycles, malformed metadata/index entries, and unmatched ccusage rows are represented as warnings in JSON.

## Local dashboard

Start a localhost-only, live dashboard in the background (the default is port
4242):

```sh
codex-session-usage start
codex-session-usage start --port 4242
codex-session-usage stop
# or with Nix
nix run . -- start --port 4242
```

`start` waits for the health check and prints the URL. It will reuse an already
running dashboard on the same port, and refuses to replace one on a different
port. The server is bound exclusively to `127.0.0.1`, serves no prompts or raw
rollout contents, and refreshes a shared offline `ccusage` snapshot about every
four seconds. The page includes totals, model/session token bars, search and
sorting, and an accessible per-session detail dialog for the root and its
subagents.

The page uses ccusage's API-equivalent estimate, not a ChatGPT subscription
charge or quota. A rollout containing exactly one model gets an exact model
price. For a multi-model rollout, its price remains in the session/thread total
but is explicitly shown as unallocated rather than guessed for a model.

State and logs are user-scoped in `$XDG_RUNTIME_DIR/codex-session-usage/` when
available; otherwise they are in `${TMPDIR:-/tmp}/codex-session-usage-<uid>/`
as `dashboard.json` and an instance-specific `dashboard-<instance>.log`. The runtime directory must be private,
non-symlinked, and owned by the current user. If startup fails, inspect that
log; `stop` verifies the daemon's private health token before signalling its
saved PID and removes stale state safely.

## Nix

```sh
nix develop
codex-session-usage --json
# one-off
nix run github:moons-14/codex-session-usage -- --json
```

The flake supplies Bun, TypeScript tooling, and a ccusage v20.0.19 input. Its package is a thin launcher and supports x86_64/aarch64 Linux plus aarch64 Darwin.

## License and attribution

This project is MIT-licensed. It does not vendor ccusage code; it invokes the independently installed [ccusage](https://github.com/ccusage/ccusage), which is MIT-licensed. ccusage v20.0.19+ is required because it fixes Codex replayed-parent usage and reasoning-total accounting.
