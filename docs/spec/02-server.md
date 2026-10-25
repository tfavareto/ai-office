# Server spec (@ai-office/server)

## Configuration (env)
AI_OFFICE_PORT (4848), AI_OFFICE_HOST (127.0.0.1), AI_OFFICE_CLAUDE_DIRS (comma-separated config dirs; default:
every `~/.claude*` directory containing `projects/`, plus CLAUDE_CONFIG_DIR), AI_OFFICE_STATE_DIR (~/.ai-office),
AI_OFFICE_DEMO=1 (start with demo on), AI_OFFICE_ALLOW_REMOTE=1 (accept a non-loopback AI_OFFICE_HOST; refused
otherwise), AI_OFFICE_CODEX_DIRS (comma-separated extra Codex homes, read besides `CODEX_HOME` / `~/.codex`),
AI_OFFICE_CODEX=0 (never read Codex sessions, whatever Settings says). CLI flags may mirror these (`--port`, `--demo`,
`--allow-remote`, `--codex-dirs`). The state dir also holds `token`
(random 32 bytes hex, mode 0600) that every `/api/*` route but `GET /api/health` requires (see 01-architecture Security).

## Claude Code data sources (public on-disk formats, per config dir `<dir>`)
- `<dir>/sessions/<pid>.json`: registry of running sessions: `{ pid, sessionId, cwd, startedAt, kind, entrypoint,
  name?, status: 'busy' | 'idle' | ..., updatedAt, statusUpdatedAt }`. A session is **open** while its file exists and
  the pid is alive (Node: signal-0 liveness check on the pid). `name` is the session title; status busy means working,
  idle means idle.
- `<dir>/projects/<encoded-cwd>/<sessionId>.jsonl`: main transcript, one JSON object per line. Relevant line types:
  `user`, `assistant`, `system`, `attachment`, `custom-title` ({customTitle}), `last-prompt`, `mode`; ignore the rest.
  Common fields: `uuid`, `parentUuid`, `timestamp` (ISO), `sessionId`, `cwd`, `gitBranch`, `isSidechain`, `version`,
  `permissionMode` (user lines). `message` is an Anthropic message: `role`, `model`, `content` (string or blocks:
  `text`, `thinking`, `tool_use` {id, name, input}, `tool_result` {tool_use_id, content, is_error}, `image`), `usage`
  ({input_tokens, output_tokens, cache_creation_input_tokens, cache_read_input_tokens}), `stop_reason`. User lines with
  `toolUseResult` carry structured tool results (e.g. Edit/Write patches with line counts).
- `<dir>/projects/<encoded-cwd>/<sessionId>/subagents/agent-<agentId>.jsonl`: subagent transcript (same line format;
  lines carry `agentId`), plus `agent-<agentId>.meta.json` `{ agentType, description, toolUseId, spawnDepth }`.
- The parent's `tool_use` that spawned the subagent is the `Task` or `Agent` tool (`input.subagent_type`,
  `input.description`, `input.prompt`); its `tool_result` marks the subagent done.

Tail files incrementally (keep byte offsets; handle partial last lines, truncation and rotation). Use fs.watch with a
1 s polling fallback. On startup, load sessions active in the last 12 h (and all open ones) reading only the tail
needed for state (last ~2 MB); long history is read lazily for `/api/history` and `/api/transcript`.

## Codex data sources (OpenAI Codex CLI, read-only, `packages/server/src/codex/`)
A Codex home is `CODEX_HOME` (default `~/.codex`) plus the folders of AI_OFFICE_CODEX_DIRS; each existing one is an
**account** (`source: 'codex'`, id `codex`, label "Codex", `codex-<name>` for the others). Only this is read, and only
this: `<home>/sessions/YYYY/MM/DD/rollout-<timestamp>-<thread id>.jsonl` and `<home>/session_index.jsonl` (the names Codex
gives threads, tail only). `auth.json`, `config.toml`, the SQLite files, logs and every other file are never opened.
- **Rollout lines**: `{ timestamp, type, payload }` with `type` in `session_meta` (first line: `id`, `cwd`, `git.branch`,
  `source`, `cli_version`; a subagent has `source: { subagent: { thread_spawn: { parent_thread_id, agent_nickname,
  agent_role } } }`, housekeeping threads such as approval reviews have `{ subagent: { other: "guardian_review" } }` or
  `"review"`, `"compact"`, `"memory_consolidation"`), `turn_context` (`cwd`, `model`, `approval_policy`,
  `sandbox_policy`), `event_msg`, `response_item`, `compacted`; everything else (`token_usage_record`, `world_state`...)
  is skipped before JSON parsing. Unknown types and malformed, partial or oversized (> 6 MB) lines are ignored.
- **Translation** (`translate.ts`): a per-file `RolloutTranslator` turns lines into the same `ParsedLine` events the Claude
  parser makes (plus `turn-start`, `turn-end`, `approval` and `usage`), so the office model, the terminal view, the day
  report and the time-lapse have one code path. Each fact has one source: prompts from `event_msg` `user_message` and the
  app's `item_completed` `UserMessage` (injected context such as `<environment_context>` is dropped); replies and
  thinking from `response_item` `message` (assistant) and `reasoning`; tool calls from `response_item` `function_call`,
  `custom_tool_call`, `local_shell_call`, `web_search_call`, the app's `item_completed` items (`CommandExecution`,
  `FileChange`, `McpToolCall`, `Extension`, `ImageView`) and the begin/end events of the CLI, deduplicated by `call_id`;
  turns from `task_started` / `task_complete` / `turn_aborted`; usage from `token_count`.
- **Tool mapping**: shell, `exec_command`, `container.exec`, `local_shell` and command items become `Bash`;
  `apply_patch` and `FileChange` become one `Write` (add) or `Edit` (update, delete) per file, with the lines added and
  removed; web searches `WebSearch`, opened pages `WebFetch`; MCP calls `mcp__<server>__<tool>`; `update_plan`
  `TodoWrite` (the tasks); `request_user_input` `AskUserQuestion`; `spawn_agent` `Agent`; `view_image` `Read`.
- **Open sessions** (no pid registry exists): a rollout counts as open while its file was modified in the last 30 minutes
  (`CODEX_OPEN_WINDOW_MS`, the same window the Claude engine uses without a registry). New rollouts are found by listing
  the day folders of the last window (every 4 s); files already followed are re-checked by `stat`. A session started
  more than a day before the window and resumed since is not found until it is written in a recent folder.
- **Status**: `working` from `task_started` (or a prompt) to `task_complete`; `waiting` while an approval request
  (`exec_approval_request`, `apply_patch_approval_request`, `request_permissions`, `elicitation_request`) or a question
  (`request_user_input`) is unanswered (waitingFor "Aprovar <ferramenta>" / the question text; there is no `permission`
  object, nothing can be answered from the page); `idle` after the turn completes or is aborted.
- **Agents**: one main agent per rollout whose first record is a plain session; `thread_spawn` threads whose parent is
  open are subagents (role `agent_role`, title `agent_nickname`); housekeeping threads are never shown. The project is
  the `cwd`, so a Codex and a Claude Code agent in the same folder share the room. The title is Codex's thread name
  (`session_index.jsonl`), else the first prompt. Agents carry `source: 'codex'`; stable names come from the same store.
- **Tokens and cost**: `token_count.info.total_token_usage` holds running totals; cached input is a cache read, the rest
  of the input is fresh, output includes reasoning. The estimate uses the OpenAI table in `shared/src/usage/pricing.ts`
  (standard tier, checked 2026-10-25); a model without a price (e.g. `codex-auto-review`) has tokens and no cost.
- **Setting**: `GET/POST /api/codex/settings` (`{ sessions, available, locked }`, local-only, token-protected) turns the
  reading on or off (stored in `<stateDir>/codex-settings.json`); `locked` means AI_OFFICE_CODEX=0. Off, the server does
  not open the Codex folder at all.
- **Read-only**: Codex has no hooks, so there are no permission requests, messages or hiring for it. `POST /api/messages`
  answers 409 `codex-read-only` when every target is a Codex agent and skips Codex agents in a team message.

## Team mode (`packages/server/src/team/`)
Full spec: [08-team-mode.md](08-team-mode.md). Summary:
- **Config**: `AI_OFFICE_TEAM=0` makes the mode unavailable; `AI_OFFICE_TEAM_LOOPBACK=1` lets a team use `127.0.0.1` (tests, demos); `AI_OFFICE_TEAM_DEVICE` sets the device name (default: the host name without `.local`). None of them touches `AI_OFFICE_HOST`.
- **Listener** (`TeamHost`): `node:net`, bound to the single address chosen in the page (private, link-local, CGNAT or loopback IPv4; never a wildcard; it must belong to an interface of this computer), refuses peers outside those ranges, framed length-prefixed protocol, no HTTP. A request that is not a team frame is dropped without a reply. Unauthenticated connections are capped (8, 3 per address) and have an 8 s handshake deadline.
- **Handshakes**: pairing with the code (X25519 + HMAC keyed from scrypt(code) + HKDF + AES-256-GCM) and the session handshake (X25519 + Ed25519 signatures over the whole transcript, host key pinned by the member, member keys stored by the host). Sealed frames use a per-direction key and an implicit counter: replay, tampering, reordering and reflection end the connection.
- **Data**: a member sends a `TeamShare` (built by `buildTeamShare` in shared, from an allowlist); the host re-reads it with `parseTeamShare`, keeps the latest per member and sends each member the merged view without its own share. Times travel as ages.
- **Storage**: `<stateDir>/team/{host,member,settings}.json` (dir 0700, files 0600): identity keys, public keys of the others, no member secret on the host.
- **REST** (local-only, token-protected; the listener serves none of it): `GET /api/team` (`TeamStatus`, including the pairing code), `POST /api/team/host/start|stop|code|revoke|end`, `POST /api/team/join|leave|sharing`. Refusals answer `{ error: TeamErrorCode }` (400 invalid input, 403 `pairing-failed`, 404 `unknown-member`, 409 state conflicts, 429, 502 `unreachable`, 504 `timeout`).
- **Snapshot**: `OfficeSnapshot.team` (`TeamSnapshot`: role, link, people with their rooms and agents, times on this computer's clock) when the computer is in a team; `agents` and `projects` stay strictly local.

## Agents
- One **main agent** per open session (sessionId + account). It enters when the session opens and leaves (`offline`)
  when the session closes (registry file gone or pid not alive) or after 30 min without events and not in registry.
- One **sub agent** per subagent transcript with events in the current session; status `done` when its spawning
  tool_use got its tool_result (or 2 min idle after the parent finished); it leaves a few seconds after done.
- Stable names: pick from ~120 Brazilian first names by hashing (account, session[, agentId]); avoid duplicates among
  agents currently present; look (f/m) comes with the name. Persist choices in `<stateDir>/names.json`.
- Role: main is "Principal"; sub is meta.agentType (fallback "Subagente"). Title: registry `name`, else
  `custom-title`, else first user prompt (80 chars max); for subagents the Task description.

## Status derivation
- `working`: a prompt/tool_result is being processed, an assistant line has pending tool_use, or registry says busy.
- `waiting`: a permission request is pending (plugin), or a Notification hook said it needs input, or an
  `AskUserQuestion` tool_use is pending (waitingFor "Responder uma pergunta", the pt-BR source of `waiting.answerQuestion`), or a tool_use has been pending over 8 s
  while the registry says idle (waitingFor "Aprovar <ferramenta>", the pt-BR source of `waiting.approve`).
- `idle`: turn finished (stop_reason end_turn or registry idle) and session open.
- Shells: Bash tool_use with `run_in_background`, or running over 10 s without result, becomes a ShellJob; removed on
  result / KillShell / BashOutput completion. Monitor-like tools use kind 'monitor'.

## Activities (one emoji)
Texts are emitted as `Msg` (shared catalogs, key + params) next to a pt-BR `text` fallback; the examples below are the pt-BR source texts, which the web app renders in the user's language.
Read: "📖 Lendo <file>"; Edit/MultiEdit: "✏️ Editando <file>"; Write: "📝 Escrevendo <file>"; Bash: "💻 <description or
command head>"; Grep/Glob: "🔎 Buscando “<pattern>”"; WebFetch/WebSearch: "🌐 ..."; Task/Agent: "👥 Delegando:
<description>"; TodoWrite: "📋 Atualizando a lista de tarefas"; mcp__x__y: "🔌 <server>: <tool>"; AskUserQuestion: "❓
Fazendo uma pergunta a você"; thinking: "💭 Pensando…"; assistant text: "💬 Escrevendo a resposta"; user prompt: "📨 Nova
tarefa: “…”"; tool error: "⚠️ Erro em <tool>"; turn end: "✅ Concluiu em <duration>". Text max 60 chars, detail 400.
Tasks come from the latest TodoWrite input (todos[]) or TaskCreate/TaskUpdate tools; each task carries `changedAt`, the time of
the tool call that created it or last changed its status or title (the task board shows it as the card's age). Stats: tool calls, usage tokens,
lines from Edit/Write results, subagents spawned; cost from a small price table per model family (opus, sonnet,
haiku, fable; input/output/cache), flagged as estimate.

## Snapshot and stream
Office emits change events; the snapshot builder throttles to 4/s max; `rev` increments; feed items pushed immediately
(batched per tick); notices on transitions: agent needs you (alert, cleared when resolved), turn completed (success),
tool error (warn, rate-limited), session opened/closed (info). SSE: `retry: 2000`, heartbeat comment every 15 s,
initial snapshot + last 100 feed items on connect, at most 20 clients (503 beyond). Count local viewers (loopback connections) so hooks know whether a
page is open.

## REST (see shared/protocol.ts)
health, stream, history, usage detail (`GET /api/usage/detail?account=<id|all>&period=today|week|month`: local-only and token-protected; 400 `invalid-period` / `invalid-account`, 404 `account-not-found`; returns totals by token type and cost, the same slice of the previous period, a time series (hourly for today, daily for the week and the month), by model, by project and by session or subagent (top 12, with titles and `officeId` for people the office knows), the open 5 h window of each account and the indexing progress), transcript (TranscriptEntry list rendered from JSONL, paginated by `after`, at most 500 entries per page, text ≤ 4 KB,
view cache ≤ ~8 MB), sessions (scan
projects dirs for sessions modified in 7 days; title from custom-title or first prompt), day (day recorder), day report (`GET /api/report/day`, see below), demo
toggle, permissions (create from hook into a pending map with 5 min expiry; wait long-poll 25 s max; detail;
decision; auto-cancel when the agent's session moves on; answered first by the approval rules, see below), messages (queue per agent, TTL 2 h, keep 50; `POST` inbox; wait
long-poll; team send to 24 agents max with a group id; delivery adds a "📨 Mensagem sua: …" activity). `POST /api/messages` and `POST /api/permissions/:id/decision` accept an optional `locale` (`pt-BR`, `en` or `es`; anything else is a 400 `invalid-locale`); the server keeps it with the queued message and returns it from the inbox so the hooks can phrase their output in that language.

## Day time-lapse (`/api/timelapse`)
`GET /api/timelapse?date=YYYY-MM-DD&account=<id|all>[&locale=]`: local-only, token-protected and `Sec-Fetch-Site` guarded like the report; `date` today or one of the six days before (400 `invalid-date` / `date-out-of-range`), `account` safe or `all` (400 `invalid-account`, 404 `account-not-found`), `locale` only picks the language of the demo's commit subjects (400 `invalid-locale`). Answers a `Timelapse` (`shared/src/timelapse/types.ts`): `projects` (id, name, `order` of first arrival, seed), `agents` (same ids as the live office, kind, parent, name, role, title, account, project, look, seed, and the status time the day recorder kept, when it ran), a time-ordered `events` list and the span worth watching (`from`, `to`).
- **Events** (agent and project by index): `arrive` / `leave`, `status` (working / waiting / idle, with the `waitingFor` message), `activity` (kind, icon, a `Msg` and its pt-BR `text`), `tasks` (the list after a change), `shell` (on / off), `permission` (a wait of at least 15 s: when it began, how long, the tool), `commit` (transcript and Git integration merged by hash), `test` (runner, outcome, counts).
- **Reuse.** It is a second product of the day report's scan: the same `readFileDay` (binary search to the start of the day, resumable, 1 MB slices that yield, byte and time budgets, 600 files), the same per-file cache and the same one-scan-at-a-time queue. A file read for the report without the moments is read again from the start of the day the first time the time-lapse asks; from then on both products are brought up to date together by appending. Subagent `.meta.json` files are read once and cached. The recorder (`timelapse/recorder.ts`) runs the live engine's own `TranscriptState` and `deriveStatus`, with the line times as the clock.
- **Approximations** (a transcript has no registry and no hooks). A person is in the office while their events are less than 30 minutes apart (the live engine's rule without a registry), and leaves 30 minutes after the last one; a subagent arrives when its call is made and leaves when the call returns (else 2 minutes after its last event). A turn without events for 10 minutes counts as finished. A **permission wait** is inferred only for tools that finish at once when allowed (Edit, MultiEdit, Write, NotebookEdit) while pending past 8 s, and for questions and plan approvals (certain); the prompts of Bash, web or MCP calls are not seen, and a Bash call over 10 s is a shell. Day boundaries are local midnights.
- **Privacy.** No message bodies. A prompt becomes the fixed "New task" message, replies and tool errors lose their text, every free-text parameter of an activity (commands, files, queries) is masked for credentials and cut to 80 characters, the session title is only the session's own `custom-title`, never the first prompt. The page is told nothing that the live feed does not already show.
- **Caps.** At most 20,000 events and 200 people. Per file, ordinary activities of one agent are at least 5 s apart (key ones - prompt, error, completion, subagent call, question - always stay; the gap grows as the file's budget of 6,000 events fills). Over the cap the day is thinned with a growing per-agent gap, then ordinary activities are dropped, then task lists are thinned, and `trimmed` is set; `truncated` is set when a scan limit was hit. Nothing is written to disk.
- **Demo.** The simulator's people work the day from `demoTimelapse` (shared): shifts shared with the demo report, turns of tool calls with shells and tests (one run fails in the week), waits, subagents who join the meeting room, commits; visitors from other projects fill the rooms; merged into the real answer.

## Usage index
A background indexer (`packages/server/src/usage/`) turns every transcript (main and `subagents/`) of every account into hourly rows and keeps them current. The usage cards and `GET /api/usage/detail` both read from it.
- **Rows.** One row per UTC hour x account x project (the first `cwd` seen in the file) x model x session x subagent id (`""` for the main transcript): `input`, `output`, `cacheWrite` (5 m and 1 h writes together), `cacheRead` and an estimated `costUSD` (shared price table, computed when indexed). Only numbers and ids are stored: no prompt, reply, tool call or file content.
- **Duplicates.** Claude Code writes one line per content block of an assistant message; every line repeats the `message.id` and a usage that may still be growing. The indexer counts one message once, keeping the field-wise maximum of its lines (`mergeUsage`), and remembers the last 16 messages of each file between runs so a message split across two reads (or a restart) is still counted once. Synthetic messages and lines without a valid timestamp are skipped.
- **Incremental reading.** Per file: byte offset (always the end of a complete line), size, mtime, inode and a hash of the first 256 bytes. A pass reads only what was appended, in 1 MB slices that yield to the event loop, so snapshots, hooks and the HTTP server are never blocked. A new file is picked up within 10 s (directory walk); files written in the last 15 min are re-checked every 2 s. A file whose inode, size or head no longer matches (replaced or truncated) rebuilds the whole index instead of counting twice.
- **Backfill.** At startup, in the background, newest files first (so the 5 h window, today and the week are right early): everything from the start of the previous calendar month. Progress (`indexing` with a percentage by bytes, then `ready`) is exposed in `GET /api/usage/detail`.
- **Persistence.** `<stateDir>/usage-index/` (mode 0700): one shard per UTC month, `YYYY-MM.json` (dictionary-coded rows, mode 0600), and `meta.json` (what was read of each transcript, relative to the account directory). Versioned (`v`), written atomically (temp file and rename), shards before `meta.json`, each carrying the generation of its save. A damaged or unknown-version file, a shard newer than `meta.json` (a save interrupted between the two) or a shard that lost rows means the index is ignored and rebuilt from the transcripts: it is only a cache. Saved at most every 15 s while dirty, after the first backfill and on stop. Rows older than 13 months (and their shards) are pruned.
- **Cards.** `UsageIndexer.compute` replaces the former in-memory tracker: the 5 h block (opens at the hour of the first message after the previous block expired, lasts 5 h), the week (Monday 00:00 local) and today (local midnight) come from the hourly totals, plus `burn` (tokens and cost of the last 30 and 60 minutes, hours with activity this week) and `peaks` (highest completed 5 h block and week of the last 90 days, with how many there were) that feed the limit forecast.
- **Codex rollouts** are indexed like transcripts (`usage/discover.ts` lists them per account). The usage of a moment is the growth of the running `total_token_usage` since the previous `token_count` of the file; the last total and its model live in the file's remembered messages, so a resumed scan counts only new growth. Subagent and housekeeping threads are rows of their parent session (agent = their thread id); housekeeping threads are left out of the day report and the time-lapse.
- **Time zones.** Rows are keyed by UTC hour; day, week and month boundaries are local midnights built with the local calendar (23 and 25 hour days at daylight saving changes work). In zones with a half-hour offset the hour that straddles midnight is counted in the day it starts in.

## Progress (`/api/progress`)
The office grows with use (see [00-product.md](00-product.md)). The server turns the finished local days into lifetime numbers, once each, and keeps today live. Code in `packages/server/src/progress/`, pure rules in `packages/shared/src/progress/`.
- **Facts.** `ProgressService` reads a day through the day report (`ReportService.report` over every account, `transient` so a look far into the past does not push the days the page shows out of the per-file cache) and `factsFromReport` keeps only counters: sessions, work time, tasks completed, commits (merged by hash), passing test runs, tokens (from the usage index), subagents, the most sessions working in one half hour, whether there was work between 00:00 and 05:00 (night owl) or 05:00 and 07:00 (early bird), and the top agents by completed tasks (name and the project folder's name, never a path). A day replaces its own earlier facts, so processing is idempotent.
- **When.** At start, in the background, one day at a time with a pause between days that had work: from the last settled day to yesterday, or at most 60 days back on the first run (Claude Code keeps transcripts about 30 days by default). A finished day read completely is settled and never read again; a day whose scan hit a limit or whose tokens came while the usage index was still building is read again, and accepted after three tries. Today is read again every 5 minutes and, without waiting, when the endpoint is asked and the last reading is over a minute old. The most agents seen in the office at once is also watched live (the day reports only know who worked in the same half hour).
- **Numbers.** `cumulativeOf(state)` sums the days (plus a folded base for days older than 400, which keeps the file small) and the high-water marks. XP (`xpOf`) = 10 per session + 20 per work hour + 5 per task + 20 per commit + 3 per passing test run + 2 per million tokens + 2 per subagent + 25 per day worked + 40 per achievement. Level thresholds (XP): 0, 150, 500, 1,200, 2,500, 5,000, 9,000, 15,000, 25,000, 40,000. The highest XP ever reached is stored, so the level never decreases, whatever happens to the history.
- **Achievements.** A table of thresholds on lifetime numbers (`ACHIEVEMENTS`): the same table gives the unlock rule, the progress of a locked one and, by replaying the days in order, the day an old one was earned. An unlock keeps the date it first got. `timelapse` and `share` are things only the page can tell (`POST /api/progress/event`).
- **Employee of the month.** The agent with the most completed tasks in the current local month (ties by name); its project is the folder where it completed most.
- **Endpoints** (local-only 403 `local-only`, token, `Sec-Fetch-Site` guarded; the POST needs JSON): `GET /api/progress[?project=1]` -> `Progress` (level and XP, lifetime numbers, every achievement with its value, target and unlock time, the employee of the month; `project=1` adds the project of the employee; `counting` while the history is still being read), `POST /api/progress/event` `{ event: "timelapse" | "share" }` -> `{ ok }` (400 `invalid-event`; the first time counts; ignored in demo mode).
- **Snapshot.** `OfficeSnapshot.progress` (`ProgressSummary`): level, XP and the bounds of the level, achievements earned and total, the latest four unlocks and the employee's **name only**. The page decides the decoration from the level, and announces what is new.
- **Persistence.** `<stateDir>/progress.json` `{ "version": 1, "days", "base", "records", "unlocks", "events", "settledThrough" }` (mode 0600, written atomically after a short delay and when the server stops, read defensively: unreadable records are dropped, a file that cannot be read or comes from a newer version is moved to `progress.json.unreadable-<time>` instead of being overwritten). Counters and names only; no prompt, reply or file content. Delete it and the history is counted again.
- **Demo.** In demo mode the endpoint and the snapshot show `demoProgress` (shared, deterministic: about six weeks of work, level 6, 13 of 22 achievements, an employee of the month from the demo's own people); the real progress is neither read nor changed. `?mock=1` does the same in the page; `?mock=1&demoLevel=<1-10>` pins the level to preview the decoration.

## Approval rules (`/api/rules`)
Standing answers to recurring permission requests. The engine is pure and lives in `packages/shared/src/rules/`
(matching, precedence, validation, the in-memory `RuleBook`); the server only persists it and wires it to the hook.

- **Rule** (`shared/src/model.ts`): `id`, `effect` (`allow`/`deny`), `tool` (`Bash`, `Edit`, `WebFetch`, or an MCP
  prefix `mcp__server__*`), `matcher` (`command-prefix` for Bash, `exact`, `path-glob` for file tools, `host` for
  WebFetch, `any`), `scope` (`projectPath` absolute, `accountId`; omitted = everywhere), `enabled`, `note?`, `locale?`
  (language of the reason sent to the agent), `createdAt`, `hits`, `lastHitAt?`. At most 200 rules; an identical rule
  is a 409 `duplicate-rule`.
- **Decision order.** For each request that reaches `POST /api/permissions` the rules run **before** the page is asked
  and whether or not a page is open. Disabled rules are ignored; any matching **deny** rule wins over every allow
  rule; among rules of the same effect the most specific wins (project scope, then account scope, then matcher
  kind and length, then the oldest). A match answers the hook through the same registry as a person
  (`PermissionRegistry.createDecided`: the request is stored already decided, never pending, the long-poll finds the
  decision at once) with `auto: "rule"`; a deny carries the rule's note (or `Tool: matcher`) as `message` and its
  `locale`. The agent gets a quiet feed activity ("Regra aprovou: npm test") and the rule's `hits`/`lastHitAt` grow.
  Requests no rule matches behave exactly as before.
- **Safety.** An allow rule never answers a risky request (shared `detectRisk`: delete, sudo, force push, reset,
  permissions, pipe-to-shell, disk, data, sensitive file writes; plus inline code such as `bash -c`, `node -e`,
  `python -c`): it is logged as `ask` and the request goes to the person. Allow `command-prefix` and `exact` rules
  match **simple commands only**: any of `; & | < > \` ` ( ) $(` or a line break (even inside quotes) makes the command
  unmatchable; prefixes match whole words (`npm test` matches `npm test -- --watch`, not `npm testx`). Deny rules also
  look inside compound commands and through `sudo`/`env`/`nohup`. `path-glob` `*`/`**` never match dot files or
  folders; paths are normalized (no `..` escape; symlinks are not resolved). **Creating or editing** an allow rule is
  refused (400, with `error`, `field`, `detail`) when it would cover something dangerous: `any` on Bash and file
  tools, `mcp__*` wildcards (only `mcp__server__*`), prefixes that are or extend `rm`, `sudo`, `git push`, `git reset`,
  `git clean`, shells, `env`, `xargs`..., compound commands, globs at the root or in system folders, or on secrets,
  and hosts like `*.com`. Rules read from disk go through the same policy: an allow rule it refuses is loaded **disabled**.
- **Endpoints** (local-only, token, `Sec-Fetch-Site`/origin guarded; `PATCH` needs JSON like `POST`, `DELETE` only the
  origin check): `GET /api/rules`, `POST /api/rules`, `PATCH /api/rules/:id` (named fields replace the rule's; `note`
  or `locale` `null` removes it), `DELETE /api/rules/:id`, `GET /api/rules/log[?limit=]` (newest first), `DELETE
  /api/rules/log`, `POST /api/rules/preview` (a rule body → `{ matches, total, since }`: how many of today's requests it
  would have answered; the server keeps the last 500 requests in memory only). Errors: 400 invalid or refused rule
  (`RuleErrorBody`), 404 unknown id, 409 duplicate or too many, 500 `save-failed` (the change is undone).
- **Persistence.** `<stateDir>/rules.json` `{ "version": 1, "rules": [...] }` and `<stateDir>/rules-log.json`
  `{ "version": 1, "entries": [...] }` (last 500 auto-decisions: outcome `allow`/`deny`/`ask`, the rule as it was, the
  request subject cut to 200 characters with URL queries removed, agent, project). Both are written atomically
  (temp file + rename) with mode 0600, debounced for counters and the log and immediately for rule edits, read
  defensively (unreadable entries dropped, bare arrays from before versions migrated), and a file that cannot be read or comes from a newer version is moved to
  `<name>.unreadable-<time>` instead of being overwritten.
- **Demo.** The simulator asks `autoDecide` before it blocks an agent; the server answers it with the same engine, so
  demo requests are decided, counted and logged (entries flagged `demo`) like real ones. `?mock=1` runs the same
  `RuleBook` in memory.

## Hiring an agent (`POST /api/agents/hire`)
Local-only (loopback bind + Host + peer, like permissions), token-protected and covered by the request guard. Body
`{ projectPath, accountId?, prompt?, model?, permissionMode?, deskIndex?, locale? }` (`HireRequest` in shared). Validation, in
this order, with the error code in `{ error }`:
- Syntax (400): `projectPath` a non-empty string ≤ 1024 chars (`invalid-projectPath`); `accountId` a string ≤ 300
  (`invalid-accountId`); `prompt` a string ≤ 8000 chars without NUL (`invalid-prompt`; trimmed, empty means none); `model` one of
  `default|opus|sonnet|haiku` (`invalid-model`); `permissionMode` one of `default|acceptEdits|plan`
  (`invalid-permissionMode`); `deskIndex` an integer 0-31 (`invalid-deskIndex`); `locale` `pt-BR|en|es`
  (`invalid-locale`). Unknown fields are ignored: the client can never choose the executable, arguments or environment.
- Folder: `~` and `~/…` expand to the home folder; the path must be absolute, free of control characters and is
  normalized (400 `invalid-projectPath`); it must exist (404 `project-not-found`), be a directory (400
  `project-not-directory`) and be readable and enterable (403 `project-not-readable`).
- Account (400 `unknown-account`): `accountId` must be one of the discovered accounts; without it the default account (`~/.claude`),
  else the first one (a computer with no account directory yet uses the default account).
- `claude` must be found like the plugin installer does (PATH entries that are absolute, then `~/.local/bin/claude`,
  `~/.claude/local/claude`): 503 `claude-not-found`.
- Rate limit: 5 launches per minute (429 `rate-limited`); only requests that reach the launcher count.
Then it opens a terminal window and answers **202** `{ hire: PendingHire }`. Launch failures: 503 `no-terminal`, 502
`terminal-failed`, 501 `unsupported-platform`.

Launch. A private directory (`mkdtemp` under the system temp dir, mode 0700) gets `launch.sh` (mode 0600), a POSIX `sh` script that
first deletes its own directory, then `cd`s into the project, exports `CLAUDE_CONFIG_DIR=<account dir>` (or unsets it for the
default account) and runs `claude [--model <alias>] [--permission-mode <mode>] [--] [<prompt>]`. Every value is written with single-quote
shell quoting (the only metacharacter inside quotes is the quote itself), the prompt is one argument (`--` precedes a prompt that starts with a
dash), and a NUL byte is refused. The terminal is told to run `/bin/sh '<script path>'`; nothing from the request ever reaches a
shell command line, an AppleScript string or an argv other than through that script. A launcher nobody ran is removed after 10 minutes. macOS: `osascript`
(argument array, no shell) opens **Terminal.app**, or **iTerm2** when it is running and Terminal.app is not; Linux tries `x-terminal-emulator`,
`gnome-terminal`, `konsole`, `xfce4-terminal` and `xterm` in order (`spawn`, detached, no shell). The launcher is an injectable
dependency (`AppOptions.hire.launcher`), so tests never open terminals.

## Day report (`packages/server/src/report/`)
`GET /api/report/day?date=YYYY-MM-DD&account=<id|all>[&requests=1][&locale=pt-BR|en|es]` -> `DayReport` (`shared/src/report/types.ts`). Local-only (403 `local-only`), token-protected, `Sec-Fetch-Site` guarded. `date` defaults to today and must be a real calendar date within the last 7 local days (400 `invalid-date` for the format, 400 `date-out-of-range` otherwise); `account` is `all` or a known id (400 `invalid-account`, 404 `account-not-found`); `requests` is `0` or `1` (400 `invalid-requests`); `locale` only picks the language of demo content (400 `invalid-locale`).

- **What is read.** Every transcript (main and subagent) of the chosen accounts modified at or after the start of the day. Per file the reader seeks to the start of the day with a binary search over line timestamps (a 500 MB file is not read from the top), parses lines until the first one past the end of the day, and keeps nothing but counters and short strings. It is async, reads 1 MB slices and yields to the event loop between slices; scans run one at a time and identical concurrent requests share one scan.
- **Cache and limits.** Each file's read state (offset, accumulator) is cached per day (at most 1200 entries); a file that only grew is resumed from its offset, a file that is past the end of the day for good is not read again, a replaced file (inode change) is read afresh. Caps: 600 files per scan, 256 MB per file, 25 s per scan; hitting one sets `truncated: true`.
- **Per session (one agent).** The session's main transcript plus its subagents' transcripts are folded together: prompts (main only), tool calls by kind (`describeToolUse` kinds), files changed (Edit, Write, MultiEdit, NotebookEdit; successful calls only; lines from the result's patch, else estimated from the input; paths relative to the project folder), commands (first line, deduplicated with run counts, credentials masked: `--token x`, `API_KEY=x`, bearer tokens, URL passwords), test runs (npm/pnpm/yarn/bun test, vitest, jest, pytest, go test, cargo test, mvn/gradle/dotnet/deno/mix/swift test, rspec, phpunit, mocha, playwright, `node --test`; outcome from the exit status and the output: counts when printed, else `FAIL` / `ok` markers; a run left in the background is `unknown`), commits (the `[branch hash] subject` lines of a successful `git commit`), tasks completed (TodoWrite / TaskCreate / TaskUpdate transitions to completed during the day; a task already completed when the day began is not claimed), subagents (Agent / Task calls and their types), active time (gaps between events up to 10 minutes count) bucketed per half hour, first and last activity.
- **Joined data.** Tokens and estimated cost per session come from the usage index (`app.usage`, hourly rows; subagents included), with `usageIndexing: true` while the index is still being built. Status times come from the day recorder (`statusMs`) when the office was running. The name is the office agent's, else the stored name, else the deterministic pick.
- **Privacy.** No message bodies. The first line of each user prompt (140 characters) is collected in memory but only sent with `requests=1`. Task titles, commit subjects, file paths and commands are shown as written by the session.
- **Git integration seam.** `ReportService` accepts an optional `gitCommits(projectPath, range)`; its commits arrive as `ReportProject.gitCommits` (`source: "git"`) and are merged with the ones seen in transcripts by hash.
- **Demo.** In demo mode the response adds `demoDayReport` (shared, deterministic per date and agent, localized) for the demo agents, with tokens and cost taken from the demo usage rows.

Pending hires. The hire is kept in a registry and travels in the snapshot as the optional `hires: PendingHire[]` (`id`, `projectId`,
`accountId`, `createdAt`, `expiresAt = createdAt + 90 s`, `deskIndex?`, `agentId?`, `demo?`). `projectId` is the room: the existing room that matches
the folder (typed or with symlinks resolved), else the resolved path (what Claude Code reports as its cwd). Every second the registry looks for a
**main, non-demo, open agent with the same account whose project is the folder and whose `startedAt` is not before the request** (oldest first; one session takes
over one hire) and sets `agentId`; the entry stays 6 s so every page can hand over, then goes away. A hire with no session after 90 s is dropped and a warn notice
("the session has not shown up yet…") is broadcast.

`GET /api/agents/hire/check?path=<folder>` → `{ ok, reason? }` (`not-absolute|not-found|not-directory|not-readable`): the same folder checks, for the
path field (120 per minute).

Demo mode. While demo mode is on, a hire into a folder that is not a room with real sessions is **simulated**: no folder, account or `claude` checks and no
terminal; the simulator keeps a pending hire for ~4.5 s and then opens a demo session in that room (its title is the prompt). The same simulator powers `?mock=1`.

## Git integration (`packages/server/src/git/`)
Each room whose folder has a `.git` (a folder, or a file pointing to the git directory) gets `Project.git` (`shared/src/git.ts`) in the
snapshot: branch (or the abbreviated commit of a detached HEAD), counts of staged / unstaged / untracked / conflicted files, lines
added and removed, upstream with ahead/behind, last commit (hash, subject cut to 120 characters, time), stash entries, the operation in
progress (merge, rebase, cherry-pick, revert, bisect) and, when enabled, the pull request. Demo rooms bring their own fake state
(`shared/src/demo/git.ts`) and are never read. A folder without `.git`, a failing repository or a missing `git` binary gives no field.

- **Read-only, bounded.** `GitWatcher` runs `git` with `execFile` (argument array, no shell, `cwd` = the project folder, 3 s timeout, 1 MB
  output cap) and an environment that holds only `PATH`, `HOME` and a few locale and temp variables plus `GIT_OPTIONAL_LOCKS=0` and
  `GIT_TERMINAL_PROMPT=0`; no credentials, no askpass. Every command starts with `--no-pager --no-optional-locks -c core.fsmonitor=false`
  (a repository's configuration cannot start a program), diffs add `--no-ext-diff --no-textconv`. The commands are `status
  --porcelain=v2 --branch --untracked-files=normal` (branch, upstream, ahead/behind from `# branch.ab`, change counts), `diff --shortstat`
  and `diff --shortstat --cached` (only when there are tracked changes), `log -1 --format=%h%x09%ct%x09%s` and `stash list`; the operation
  comes from marker files in the git directory (`rebase-merge`, `rebase-apply`, `MERGE_HEAD`, `CHERRY_PICK_HEAD`, `REVERT_HEAD`,
  `BISECT_LOG`). It never fetches, never writes and never runs a hook. A single cap of 2 programs at a time (`limitRunner`) covers the
  watcher and the day report.
- **Schedule.** A room is read when it first appears; then every 30 s while an agent in it is working or waiting and every 5 min
  otherwise; and 2 s after the last finished tool call of an agent in the room (a trailing debounce, at most 10 s of waiting), which is
  how file changes reach the watcher. Reads are skipped while nothing is due, and `onChange` fires (a snapshot is published) only when the
  state changed. Three failed reads in a row drop the last known state; a missing `git` switches the integration off for 10 minutes.
- **Pull requests (`gh`), off by default.** Only when `pullRequests` is on and only for rooms with a branch: `gh pr view --json
  number,title,state,url,isDraft,reviewDecision,statusCheckRollup` in the project folder (argument array, 15 s timeout, the person's own
  environment with prompts and colors off), at most every 2 minutes and at once when the branch changes. The JSON is validated: the state
  is `open`/`merged`/`closed`, the link must be http(s), the checks become `{ total, passed, failed, pending, failing[] }` and the CI state is
  failure > pending > success (`none` without checks). "No pull request for this branch" is not an error. A missing `gh` or one that is not
  signed in (`gh` status `missing` / `unauthenticated`) stops lookups for 10 minutes; turning the setting off hides pull requests at once.
  This is the only code in AI Office that contacts GitHub, and only through that CLI.
- **Settings** (`GET /api/git/settings` → `{ pullRequests, gh }`, `POST { pullRequests: boolean }` → the same; 400 `invalid-pullRequests`):
  local-only, token-protected, `Sec-Fetch-Site` guarded. Stored in `<stateDir>/git-settings.json` `{ "version": 1, "pullRequests": false }`
  (mode 0600, atomic). `OfficeMeta.gitPullRequests` mirrors it in the snapshot. The demo simulator follows it for its fake pull requests.
- **Day report.** `ReportService` gets `gitCommits(projectPath, range)`: `log --all --no-merges --since/--until` for the day (up to 100
  commits), limited to the configured `user.email` when there is one, returned as `ReportCommit` with `source: "git"`.

## Customization (`/api/customization`)
What the person changed about the office, kept by `CustomizationStore` (`packages/server/src/customization/`) and defined in `packages/shared/src/customization/`.

- **Document** (`Customization`, `version: 1`): `agents` (by agent id: `name`, `look`), `rooms` (by project id, the absolute folder: `alias`, `theme`, `look` for the team, `pinned`, `hidden`), `accounts` (by account id: `look`) and `order` (project ids in the order the person arranged the rooms). A `look` has `skin`, `hairStyle` (0-3), `hairColor`, `outfit` and `accessory` (`none`, `glasses`, `headphones`, `cap`); a `theme` has `color` (`#rrggbb`), `floor` (`wood`, `carpet`, `tiles`, `concrete`), `wall` (`wood`, `plaster`, `brick`, `concrete`), `plants` (`few`, `normal`, `lush`) and `sign` (`brass`, `neon`, `wood`, `minimal`). The ids of the palettes (`SKIN_TONES`, `HAIR_COLORS`, `OUTFITS`, `ROOM_COLORS`...) are stable and only grow at the end.
- **Validation** (one reader for requests, strict, and for the file, lenient). Names are 1 to 32 characters and aliases 1 to 40 (counted as characters, trimmed, spaces collapsed, NFC), with no control characters, text-direction overrides or line separators. Keys are 1 to 1024 characters without control characters and never `__proto__`, `constructor` or `prototype`. Unknown fields are refused. Limits: 300 agents, 200 rooms, 32 accounts, 200 ordered rooms, 192 KB for the document. A refused body is a 400 `{ error, field? }` with `invalid-body`, `invalid-key`, `invalid-name`, `invalid-alias`, `invalid-look`, `invalid-theme`, `invalid-order`, `too-many-items`, `too-large` or `unsupported-version`; `field` is a path such as `agents.<id>.name`.
- **Endpoints** (local-only, token-protected, `Sec-Fetch-Site`/origin guarded; `PUT` and `PATCH` need JSON like `POST`, `DELETE` only the origin check; bodies are limited to the document size, 413 above it): `GET /api/customization` → `{ customization }`; `PUT` replaces the whole document; `PATCH` takes a JSON merge patch (RFC 7386: objects merge, `null` removes a key, an array replaces: `{"agents":{"<id>":null}}` resets one agent, `{"order":null}` clears the order, `{"rooms":{"<id>":{"pinned":null}}}` unpins); `DELETE` resets everything. Every success answers the whole document; a failed save answers 500 `save-failed` and changes nothing. When a patch would pass 300 agents the oldest entries are dropped (sessions come and go).
- **Persistence.** `<stateDir>/customization.json`, mode 0600, written atomically (temp file and rename), one write after the other. A file without `version` is migrated (`MIGRATIONS`) and saved as version 1; invalid entries are dropped and the file is rewritten; a file that is not JSON, is not a document or comes from a newer version is moved to `customization.json.unreadable-<time>` and the office starts with no customization.
- **Snapshot.** `applyCustomization` (shared, pure) runs on every computed office state: an agent with a chosen name shows it as `name` and keeps the picked one as `defaultName`; its resolved look (agent, then room, then account, field by field; a subagent takes the room and account of its main agent) is `appearance`; a room with an alias shows it as `name` and keeps the folder's as `originalName`, carries `theme`, and `pinned`, `hidden` and `rank` (its position in `order`). A change recomputes the office, so every page gets it in the next snapshot. The page does the arranging (see [04-ui.md](04-ui.md#customization)).
- **Names.** `NameStore` keeps the names the office picks in `names.json` as before and shows the chosen one through `display(key, person)`; feed items, notices and the day report use it too. The picked name never changes, so resetting brings it back.
- **Demo.** The simulator puts a customization of its own on its first three rooms and agents (aliases, finishes, two names, accessories); a person's choices go on top of it.

## Day recorder
Every 5 s add time per status per present agent into `<stateDir>/days/YYYY-MM-DD.json` (flush every 30 s).
`/api/day` returns it (today by default).

## Demo
Fake sessions (3-4 projects, 4-8 agents with subagents) driven by a script of realistic activities, statuses, shells,
permission requests (answerable; decision simulated) and errors. The demo accounts also have ten weeks of synthesized hourly usage (working-day pattern, several projects, models and sessions; today's sessions are the demo agents; the last hours are always active); the cards and `GET /api/usage/detail` are computed from it with the same code as real data. The same simulator (pure, in shared) powers the
client's `?mock=1`. It also opens two Codex sessions (account "Codex", `source: 'codex'`): one in a room shared with a Claude Code session, one alone; they wait on approvals (no permission to answer), take no messages and have their own usage history.

## Static web
Serve packages/web/dist with correct MIME types, `index.html` no-cache, hashed assets immutable; SPA fallback.
