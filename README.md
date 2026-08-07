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

Human output is one compact bordered table per root session: it shows the root title from `$CODEX_HOME/session_index.jsonl`, a shortened session ID, model token totals, and a session-level estimated cost. The title index is optional; its last valid record for an ID wins, and missing titles display as `Untitled`. `--json` retains the full ID and adds `title` and `costUSD`.

The cost is ccusage/LiteLLM's API-equivalent USD estimate. It is not a ChatGPT subscription charge, quota, or invoice. ccusage's Codex adapter v20.0.19 exposes a cost only for an entire rollout, not for its individual models, so model rows intentionally show `—` and only the session total has a cost.

Current logs group by `payload.session_id`. Legacy logs follow `parent_thread_id` only when metadata confirms a subagent; `forked_from_id` is never followed. Missing parents, cycles, malformed metadata/index entries, and unmatched ccusage rows are represented as warnings in JSON.

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
