# @ai-office/server

Node 22 HTTP server (`node:http`, no framework) that turns the Claude Code sessions on this computer into the
`OfficeSnapshot` stream consumed by the web app, and serves the REST endpoints used by the web app and the plugin hooks.

```
npm run dev -w @ai-office/server        # tsx watch, port 4848
npm run build -w @ai-office/server      # esbuild bundle (shared included) -> dist/index.js
npm start                               # node dist/index.js
```

Configuration (env or flags; flags win): `AI_OFFICE_PORT`/`--port`, `AI_OFFICE_HOST`/`--host`,
`AI_OFFICE_CLAUDE_DIRS`/`--claude-dirs`, `AI_OFFICE_STATE_DIR`/`--state-dir`, `AI_OFFICE_DEMO=1`/`--demo`,
`AI_OFFICE_WEB_DIR`/`--web-dir`, `AI_OFFICE_LOG=quiet|debug` (`--quiet`, `--debug`), `AI_OFFICE_ALLOW_REMOTE=1`/`--allow-remote`
(required for any non-loopback `AI_OFFICE_HOST`; browsers still cannot sign in remotely).

Access: the server writes a random token to `<state dir>/token` (mode 0600). All `/api/*` routes except `GET /api/health`
need it (`Authorization: Bearer`, or the cookie the server sets when it serves the page). See `docs/spec/01-architecture.md`.

## Layout

| Folder | Role |
| --- | --- |
| `src/claude/` | Reading Claude Code files: accounts, session registry (+ pid liveness), incremental JSONL tailer, line parser, transcript reducer (`TranscriptState`), tasks, stats and cost, subagent discovery, transcript renderer, recent-sessions scan, usage backfill, ingest `Engine`. |
| `src/office/` | The model: `Office` (agents, projects, feed, notices), pure status derivation, subagent lifecycle rules, names, snapshot publisher (≤ 4/s), per-account usage, day recorder. |
| `src/registries/` | Permissions (pending map, expiry, long-poll), messages (queues, TTL 2 h, inbox, long-poll, groups), attention (Notification hook). |
| `src/http/` | Request guard, router, SSE hub, static files, one handler module per route group. |
| `src/app.ts` | Composition root (`createApp`). `src/index.ts` is the CLI entry. |

## Behaviour notes

- **Open sessions** come from `<dir>/sessions/<pid>.json` with a live pid. Accounts without that directory fall back to
  transcripts modified in the last 30 minutes.
- **Status**: `waiting` (permission, attention mark, `AskUserQuestion`/`ExitPlanMode`, registry `waiting`, or a tool
  pending over 8 s while the registry says idle) > `working` (turn in progress or registry busy) > `idle`.
- **Subagents** come from `<session>/subagents/agent-*.jsonl` (+ `.meta.json`). They are `done` when the spawning
  `Agent`/`Task` call returned (or a `<task-notification>` arrived for background agents), when they ended their own turn,
  or after 2 minutes without events; they leave 6 s later. A subagent that resumes after its notice comes back.
- **Stats** only cover what the server has read (the last ~2 MB of each transcript at startup, then everything new).
  Costs use public list prices per model family and are estimates. Token counts exclude cache reads.
- **Usage windows**: the 5 h block starts at the first message after the previous block expired (rounded down to the hour);
  the week starts on Monday 00:00 local time.
- **`/api/transcript`**: `after` is an entry index and `next` points at the oldest tool entry still waiting for its
  result, so tool entries can reappear with their result filled in (clients replace tool entries by `id`).
  `agent` accepts the subagent's `Agent.id` or its raw id.
- **Local-only endpoints** (transcript, sessions, permissions, messages, attention) require a loopback bind, a loopback
  `Host` and a loopback peer.
- **Notification hook** (`POST /api/attention`): `{ session_id, agent_id?, message?, notification_type? }`; idle-prompt
  notifications are ignored, anything else marks the agent as waiting until its next transcript event.

## Tests

`npx vitest run --project server` — synthetic fixtures only (temp dirs), including an end-to-end HTTP suite that boots
the real server on a free port.
