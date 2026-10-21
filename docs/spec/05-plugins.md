# Claude Code plugin spec — packages/plugins

Repository-level marketplace: `.claude-plugin/marketplace.json` at the **repo root** named `ai-office`, listing one
plugin `ai-office` with `source: ./packages/plugins/ai-office`. Plugin dir: `.claude-plugin/plugin.json` (name, version
= root package version, description, author "Thiago Salazar Favareto", license MIT, keywords) and `hooks/hooks.json`.

Hook scripts: plain Node (22+) ES modules using only `node:*` imports (Claude Code copies only the plugin folder into
its cache), invoked as `node "${CLAUDE_PLUGIN_ROOT}/hooks/<script>.mjs"`. Port from AI_OFFICE_PORT (default 4848).
Debug log to stderr when AI_OFFICE_HOOK_DEBUG=1. **Never fail a session**: any error, timeout or AI Office offline means
exit 0 with no output, fast (< 1.5 s when offline).

Authentication: hooks read the access token from `$AI_OFFICE_STATE_DIR/token` (else `~/.ai-office/token`) and send
`Authorization: Bearer <token>` on every request. If the file is missing, unreadable or malformed they behave as "AI
Office offline" and make no request. Before the first authenticated request of a run they challenge the server
(`GET /api/health?challenge=<random nonce>`) and only continue when the answer carries the HMAC proof of that nonce, so
a stranger listening on the port never sees the token and can never get a permission auto-approved. A 401 later on is
treated as offline too. When the server uses `--state-dir`, set `AI_OFFICE_STATE_DIR` for Claude Code as well.

1. `permission.mjs` — PermissionRequest (matcher "*", timeout 330 s, statusMessage "Aguardando resposta no AI Office"):
   read stdin JSON; skip AskUserQuestion; POST /api/permissions (trimmed input, body ≤ 200 KB); on `{id}` long-poll
   GET /api/permissions/:id/wait?timeout=25 until decided or 300 s; output
   `{"hookSpecificOutput":{"hookEventName":"PermissionRequest","decision":{"behavior":"allow","updatedPermissions":[<the
   chosen original suggestion>]}}}` or `{"behavior":"deny","message":"<fixed phrase>: <reason>",
   "interrupt":<bool>}` where the fixed phrase follows the decision's `locale` ("Recusado pelo usuário no AI Office", "Denied by the user in AI Office" or "Rechazado por el usuario en AI Office"; pt-BR when absent). When the decision carries `auto: "rule"` (an approval rule answered, see 02-server.md) the phrase says so instead ("Recusado por regra do AI Office", "Denied by an AI Office rule", "Rechazado por una regla de AI Office") and the reason is the rule's note or `Tool: matcher`; an old plugin that ignores `auto` still denies, with the user phrase. "terminal"/expired/any error: no output.
2. `messages.mjs` — PostToolUse (matcher "*", timeout 10): POST /api/messages/inbox {session, agent?, via:"tool"} → output
   `{"hookSpecificOutput":{"hookEventName":"PostToolUse","additionalContext":"<preamble>\n\n<text>"}}`. Stop (timeout 660, statusMessage "De plantão: aguardando ordens no AI Office"):
   inbox via=stop (POST), else long-poll /api/messages/wait (25 s steps, total AI_OFFICE_STANDBY_MIN default 10, 0 disables;
   stops on `{skip}`) → output `{"decision":"block","reason":"<preamble>\n\n
   <text>"}`. The preamble ("seu chefe"/"your boss"/"tu jefe" wording, singular or plural) is chosen from the `locale` the inbox returns with the messages (the most recent declared one; pt-BR when none). SubagentStop (timeout 10): only with agent_id; inbox via=stop; no standby. Multiple messages numbered.
3. `notify.mjs` — Notification (timeout 5): POST /api/attention {session_id, agent_id?, message} so the office marks
   the agent as waiting (server endpoint to add: local-only, clears on the next transcript event).

Installer `scripts/install.mjs install|uninstall|status [--dry-run] [--account <dir>]`: detect account dirs like the
server; for each run `claude plugin marketplace add <repo root>` / `claude plugin install ai-office@ai-office --scope
user` (env CLAUDE_CONFIG_DIR per account, except the default ~/.claude), `update` when versions differ, uninstall removes
plugin + marketplace; status prints per account. Inject the `claude` runner for tests. Requires Claude Code CLI on PATH.

Tests: run each hook as a real child process against a tiny in-process fake server (permission allow/deny/terminal,
offline exit fast, messages delivery, standby wake-up, subagent guard, denial and preamble language); installer plan tests with a fake CLI.
