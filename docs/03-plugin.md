# The Claude Code plugin

This guide explains the `ai-office` plugin: what each hook does, how permission answers and message delivery work, what happens when AI Office is not running, and how to install and manage it across accounts.

The office works without the plugin: it only needs to read Claude Code's files. The plugin adds the parts that need to act inside a session: answering permission requests, delivering messages and flagging that an agent needs you.

## What it is

One plugin, `ai-office`, published by this repository's own marketplace (`.claude-plugin/marketplace.json`, also named `ai-office`). Its source is `packages/plugins/ai-office`: a manifest, `hooks/hooks.json` and three small Node.js scripts. The scripts import only `node:*` modules because Claude Code copies just the plugin folder into its cache. Every hook talks to `127.0.0.1` only.

## Hooks

| Event | Script | Timeout | What it does |
| --- | --- | --- | --- |
| `PermissionRequest` (all tools) | `permission.mjs` | 330 s | Sends the permission request to the office and waits for your answer. Status line: "Aguardando resposta no AI Office". |
| `PostToolUse` (all tools) | `messages.mjs` | 10 s | After a tool call, delivers any queued message as extra context. |
| `Stop` | `messages.mjs` | 660 s | When the agent finishes its turn, delivers queued messages as a new instruction; with nothing queued and a page open, waits "on stand-by". Status line: "De plantão: aguardando ordens no AI Office". |
| `SubagentStop` | `messages.mjs` | 10 s | Same as `Stop` for subagents, without stand-by. Only acts for real subagents. |
| `Notification` | `notify.mjs` | 5 s | Tells the office the agent is waiting for you. |

## Permission answers

When Claude Code is about to show a permission dialog, the `PermissionRequest` hook runs.

1. The hook posts the request (tool name and input, trimmed so the body stays under 200 KB) to the server.
2. If no page is open on this computer, or the session is unknown to the office, the server answers "skip" and the hook exits silently: the terminal dialog proceeds as usual. The hook also skips `AskUserQuestion`, which is a question rather than a permission.
3. Otherwise a **Pedido de permissão** (permission request) card appears in the agent's drawer, the agent gets the **Precisa de você** status and the hook waits.
4. Your answer becomes the hook's output:

| Your answer | What Claude Code receives |
| --- | --- |
| **Aprovar** (approve) | Allow, once. |
| **Aprovar e não perguntar de novo** (approve and do not ask again) | Allow, plus the permission rule Claude Code suggested (for example "always allow this command"), exactly as it proposed it. There is one button per suggestion. |
| **Recusar** (refuse) | Deny with the message "Recusado pelo usuário no AI Office: <your reason>" so the agent knows why. The optional **Interromper o turno do agente** checkbox also interrupts the turn. |
| **Responder no terminal** (answer in the terminal) | No output; the terminal dialog stays in charge. |
| No answer | No output; the terminal dialog stays in charge. |

**The terminal always keeps working.** The terminal dialog is never removed, so the first answer wins. If you answer in the terminal while the card is open, the office notices that the session moved on and withdraws the card.

**Timeout.** The hook waits `AI_OFFICE_PERMISSION_TIMEOUT` seconds (default 300; values outside 5 to 1800 are clamped). In practice the longest wait is 5 minutes, because the server expires a request after 5 minutes and the hook's own timeout in `hooks.json` is 330 seconds; a larger value does not extend it. Lower it if you want the terminal dialog back sooner. The card shows a countdown ("expira em").

A permission request that cannot be matched to an agent in the office is skipped, so the terminal dialog handles it.

## Messages to agents

You write a message in the agent's **Mensagens** tab (or to a whole room). It is queued on the server and handed to the agent by the next hook that asks for it. The message text reaches the agent labeled as coming from "seu chefe" (your boss) through the office.

There are two delivery paths:

| Path | Hook | When | Status in the office |
| --- | --- | --- | --- |
| During work | `PostToolUse` | After the agent's next tool call. The message is added to the tool result as additional context, with a note asking the agent to take it into account and adjust course if needed. | **Entregue durante o trabalho** (delivered while working) |
| As a new instruction | `Stop` or `SubagentStop` | When the agent is about to end its turn. The stop is blocked and the message is given as the reason, so the agent continues with it as a new instruction. | **Entregue como nova instrução** (delivered as a new instruction) |

If several messages are waiting they are delivered together as a numbered list.

**Stand-by ("de plantão").** When the agent finishes its turn with nothing queued, the `Stop` hook does not return immediately. If a page is open on this computer, it waits in 25-second long-polls for a message, for up to `AI_OFFICE_STANDBY_MIN` minutes (default 10, maximum 10, `0` disables it). A message sent during stand-by is delivered at once as a new instruction, so an agent that looks idle can be woken from the office. Stand-by ends early if the server says no page is open or the session is unknown. During stand-by, Claude Code shows the status line "De plantão: aguardando ordens no AI Office".

**Status of a message.**

| Status | Meaning |
| --- | --- |
| **Na fila** (queued) | Not picked up yet. An agent only asks at a tool call or at the end of a turn, so a message sent to an idle agent without stand-by stays queued until it does something. |
| **Entregue durante o trabalho** | Delivered through `PostToolUse`. |
| **Entregue como nova instrução** | Delivered through `Stop` or `SubagentStop`. |
| **Expirou** (expired) | Still queued after 2 hours. |

Limits: the server keeps the last 50 messages per agent and accepts up to 8000 characters (the composer stops at 4000). A team message goes to at most 24 agents and is tracked as a group ("2 de 3 entregues").

## Notifications and attention

When Claude Code raises a notification (for example, it needs your permission), the `Notification` hook tells the office. The agent becomes **Precisa de você** with the text "Precisa de você", appears in the **precisam de você** counter, and an alert toast is raised. The mark clears on the agent's next transcript event, or after 30 minutes. Notifications that only say the agent is waiting for your input in an idle prompt are ignored, so an idle session does not look urgent.

The office does not need the hook to notice most waiting states: it also detects pending permission prompts, pending questions and plan approvals from the transcript. The hook covers the cases where Claude Code knows something the transcript does not show yet.

## When AI Office is not running

Hooks are designed never to hurt a session. Every hook ends with exit code 0 and no output when:

- the token file cannot be read (AI Office never started, or `AI_OFFICE_STATE_DIR` differs);
- the port refuses the connection (nothing is listening: this fails in milliseconds, and the whole hook ends well under 1.5 seconds);
- the server on the port cannot prove it is AI Office (see below);
- the server answers 401;
- anything times out or throws.

Before sending the token anywhere, a hook challenges the server: it calls `GET /api/health?challenge=<random>` and requires an HMAC of that value made with the token. A stranger listening on the port cannot produce it, so a stranger can never receive the token or get a permission auto-approved. Each hook also has a safety timer that force-exits if something hangs.

## Multiple accounts

An account is a Claude config directory (`~/.claude`, `~/.claude-work`, ...). Plugins are installed per account, so install it in each one: the installer does this for every detected account in one run. All accounts' hooks talk to the same server, identified by the port and the token file. If the server uses a custom state directory, also set `AI_OFFICE_STATE_DIR` for the Claude Code sessions. Account discovery rules are in [configuration](04-configuration.md#multiple-accounts).

## Install and manage the plugin

From the repository folder:

```sh
npm run plugin:install      # install or update in every detected account
npm run plugin:status       # report per account
npm run plugin:uninstall    # remove from every detected account
```

Pass options after `--`: `--dry-run` previews changes, `--account <dir>` (repeatable) replaces detection, `--claude <path>` chooses the executable. For example:

```sh
npm run plugin:install -- --dry-run
npm run plugin:install -- --account ~/.claude-work --claude ~/.local/bin/claude
```

What the installer does, per account (with `CLAUDE_CONFIG_DIR` set to that account, except for `~/.claude`):

| Command | Effect |
| --- | --- |
| `install` | `claude plugin marketplace add <repo>` (or `marketplace update` if already added), then `claude plugin install ai-office@ai-office --scope user`, or `claude plugin update` if the installed version differs from the repository's. |
| `uninstall` | `claude plugin uninstall ai-office@ai-office --scope user`, then `claude plugin marketplace remove ai-office`. |
| `status` | Prints whether the marketplace is added and which plugin version is installed, and whether it is up to date. |

If `claude` is not on `PATH`, the installer tries `~/.local/bin/claude` and `~/.claude/local/claude`. An account that fails does not stop the others; the exit code is 1 if any failed.

After installing or updating, run `/reload-plugins` in each running Claude Code session (or restart it) so it loads the hooks.

To do it by hand:

```sh
claude plugin marketplace add /path/to/ai-office
claude plugin install ai-office@ai-office --scope user
```

For a second account, run the same commands with `CLAUDE_CONFIG_DIR=~/.claude-work` in front of each.

## Next

- [Using the office](02-using-the-office.md): the cards and tabs described here.
- [Configuration](04-configuration.md): hook environment variables.
- [Privacy and security](05-privacy-and-security.md): the token and the request guards.
- [Troubleshooting](08-troubleshooting.md): permissions not showing, messages stuck on **Na fila**.
- [Plugin spec](spec/05-plugins.md) and the [plugin package notes](../packages/plugins/ai-office/README.md).
