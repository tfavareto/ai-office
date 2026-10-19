# Server spec (@ai-office/server)

## Configuration (env)
AI_OFFICE_PORT (4848), AI_OFFICE_HOST (127.0.0.1), AI_OFFICE_CLAUDE_DIRS (comma-separated config dirs; default:
every `~/.claude*` directory containing `projects/`, plus CLAUDE_CONFIG_DIR), AI_OFFICE_STATE_DIR (~/.ai-office),
AI_OFFICE_DEMO=1 (start with demo on). CLI flags may mirror these (`--port`, `--demo`).

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
  `AskUserQuestion` tool_use is pending (waitingFor "Responder uma pergunta"), or a tool_use has been pending over 8 s
  while the registry says idle (waitingFor "Aprovar <ferramenta>").
- `idle`: turn finished (stop_reason end_turn or registry idle) and session open.
- Shells: Bash tool_use with `run_in_background`, or running over 10 s without result, becomes a ShellJob; removed on
  result / KillShell / BashOutput completion. Monitor-like tools use kind 'monitor'.

## Activities (pt-BR text, one emoji)
Read: "📖 Lendo <file>"; Edit/MultiEdit: "✏️ Editando <file>"; Write: "📝 Escrevendo <file>"; Bash: "💻 <description or
command head>"; Grep/Glob: "🔎 Buscando “<pattern>”"; WebFetch/WebSearch: "🌐 ..."; Task/Agent: "👥 Delegando:
<description>"; TodoWrite: "📋 Atualizando a lista de tarefas"; mcp__x__y: "🔌 <server>: <tool>"; AskUserQuestion: "❓
Fazendo uma pergunta a você"; thinking: "💭 Pensando…"; assistant text: "💬 Escrevendo a resposta"; user prompt: "📨 Nova
tarefa: “…”"; tool error: "⚠️ Erro em <tool>"; turn end: "✅ Concluiu em <duration>". Text max 60 chars, detail 400.
Tasks come from the latest TodoWrite input (todos[]) or TaskCreate/TaskUpdate tools. Stats: tool calls, usage tokens,
lines from Edit/Write results, subagents spawned; cost from a small price table per model family (opus, sonnet,
haiku, fable; input/output/cache), flagged as estimate.

## Snapshot and stream
Office emits change events; the snapshot builder throttles to 4/s max; `rev` increments; feed items pushed immediately
(batched per tick); notices on transitions: agent needs you (alert, cleared when resolved), turn completed (success),
tool error (warn, rate-limited), session opened/closed (info). SSE: `retry: 2000`, heartbeat comment every 15 s,
initial snapshot + last 100 feed items on connect. Count local viewers (loopback connections) so hooks know whether a
page is open.

## REST (see shared/protocol.ts)
health, stream, history, transcript (TranscriptEntry list rendered from JSONL, paginated by `after`), sessions (scan
projects dirs for sessions modified in 7 days; title from custom-title or first prompt), day (day recorder), demo
toggle, permissions (create from hook into a pending map with 5 min expiry; wait long-poll 25 s max; detail;
decision; auto-cancel when the agent's session moves on), messages (queue per agent, TTL 2 h, keep 50; inbox; wait
long-poll; team send to 24 agents max with a group id; delivery adds a "📨 Mensagem sua: …" activity).

## Day recorder
Every 5 s add time per status per present agent into `<stateDir>/days/YYYY-MM-DD.json` (flush every 30 s).
`/api/day` returns it (today by default).

## Demo
Fake sessions (3-4 projects, 4-8 agents with subagents) driven by a script of realistic activities, statuses, shells,
permission requests (answerable; decision simulated) and errors. The same simulator (pure, in shared) powers the
client's `?mock=1`.

## Static web
Serve packages/web/dist with correct MIME types, `index.html` no-cache, hashed assets immutable; SPA fallback.
