# Server spec (@ai-office/server)

## Configuration (env)
AI_OFFICE_PORT (4848), AI_OFFICE_HOST (127.0.0.1), AI_OFFICE_CLAUDE_DIRS (comma-separated config dirs; default:
every `~/.claude*` directory containing `projects/`, plus CLAUDE_CONFIG_DIR), AI_OFFICE_STATE_DIR (~/.ai-office),
AI_OFFICE_DEMO=1 (start with demo on), AI_OFFICE_ALLOW_REMOTE=1 (accept a non-loopback AI_OFFICE_HOST; refused
otherwise). CLI flags may mirror these (`--port`, `--demo`, `--allow-remote`). The state dir also holds `token`
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
health, stream, history, transcript (TranscriptEntry list rendered from JSONL, paginated by `after`, at most 500 entries per page, text ≤ 4 KB,
view cache ≤ ~8 MB), sessions (scan
projects dirs for sessions modified in 7 days; title from custom-title or first prompt), day (day recorder), demo
toggle, permissions (create from hook into a pending map with 5 min expiry; wait long-poll 25 s max; detail;
decision; auto-cancel when the agent's session moves on; answered first by the approval rules, see below), messages (queue per agent, TTL 2 h, keep 50; `POST` inbox; wait
long-poll; team send to 24 agents max with a group id; delivery adds a "📨 Mensagem sua: …" activity). `POST /api/messages` and `POST /api/permissions/:id/decision` accept an optional `locale` (`pt-BR`, `en` or `es`; anything else is a 400 `invalid-locale`); the server keeps it with the queued message and returns it from the inbox so the hooks can phrase their output in that language.

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

## Day recorder
Every 5 s add time per status per present agent into `<stateDir>/days/YYYY-MM-DD.json` (flush every 30 s).
`/api/day` returns it (today by default).

## Demo
Fake sessions (3-4 projects, 4-8 agents with subagents) driven by a script of realistic activities, statuses, shells,
permission requests (answerable; decision simulated) and errors. The same simulator (pure, in shared) powers the
client's `?mock=1`.

## Static web
Serve packages/web/dist with correct MIME types, `index.html` no-cache, hashed assets immutable; SPA fallback.
