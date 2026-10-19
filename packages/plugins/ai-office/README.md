# AI Office Claude Code plugin

Connects Claude Code sessions to the AI Office web app. All hooks talk to `127.0.0.1` only and exit
silently (in well under 1.5 s) when AI Office is not running, so they can never break a session.

| Hook                | Script                 | What it does                                                                                                                                                    |
| ------------------- | ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PermissionRequest` | `hooks/permission.mjs` | Sends the permission request to the office and waits (up to 5 min) for your answer; "answer in the terminal" or no answer leaves the terminal dialog in charge. |
| `PostToolUse`       | `hooks/messages.mjs`   | Delivers queued messages to the agent as extra context after a tool call.                                                                                       |
| `Stop`              | `hooks/messages.mjs`   | Delivers queued messages as a new instruction; with a page open it waits "on standby" for up to 10 min.                                                         |
| `SubagentStop`      | `hooks/messages.mjs`   | Same as `Stop` for subagents, without standby.                                                                                                                  |
| `Notification`      | `hooks/notify.mjs`     | Tells the office the agent is waiting for you.                                                                                                                  |

## Install

From the repository root (needs the `claude` CLI on `PATH`):

```sh
npm run plugin:install     # every detected account; add -- --dry-run to preview
npm run plugin:status
npm run plugin:uninstall
```

Pass `-- --account <dir>` to target one Claude Code config directory, or `-- --claude <path>` to choose the executable.
Restart running Claude Code sessions afterwards. To do it by hand:

```sh
claude plugin marketplace add /path/to/ai-office
claude plugin install ai-office@ai-office --scope user
```

## Configuration

Environment variables, read by the hooks:

| Variable                       | Default | Meaning                                                                   |
| ------------------------------ | ------- | ------------------------------------------------------------------------- |
| `AI_OFFICE_PORT`               | `4848`  | Port of the AI Office server.                                             |
| `AI_OFFICE_PERMISSION_TIMEOUT` | `300`   | Seconds to wait for a permission answer (clamped to 5-1800).              |
| `AI_OFFICE_STANDBY_MIN`        | `10`    | Minutes the `Stop` hook waits for a message (0-10; `0` disables standby). |
| `AI_OFFICE_HOOK_DEBUG`         | unset   | `1` logs what each hook does to stderr.                                   |

## Development

Hooks are plain Node 22+ ES modules that import only `node:*` modules (Claude Code copies just this folder into its
cache). Tests live in `packages/plugins/test` and run with `npx vitest run --project plugins`.
