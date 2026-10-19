# Prompt catalog

Copy-paste prompts that let an AI agent with terminal access (Claude Code, Codex or similar) install, run, maintain and contribute to AI Office for you. Each prompt is a self-contained recipe with the agent's permissions spelled out, concrete commands, checks and a final report format.

## Catalog

| Prompt | Purpose | When to use |
| --- | --- | --- |
| [01 · Install and run](01-install-and-run.md) | Checks Node, npm, git and the `claude` CLI, clones to a folder you choose, builds, starts the server, installs the plugin, opens the office | First time on this computer |
| [02 · Run at login](02-run-at-login.md) | Creates and loads a launchd LaunchAgent (macOS) or a systemd user service (Linux) with absolute paths, a log and a restart policy | You want the office always available |
| [03 · Update](03-update.md) | Pulls (stops if you have local changes), reinstalls, rebuilds, restarts the server and refreshes the plugin | A new version is out |
| [04 · Multiple accounts](04-multiple-accounts.md) | Finds your `~/.claude*` folders, sets `AI_OFFICE_CLAUDE_DIRS` if needed and installs the plugin in each account | You use more than one Claude account |
| [05 · Troubleshoot](05-troubleshoot.md) | Read-only diagnosis first, then fixes applied one at a time with your approval | Something does not work |
| [06 · Uninstall](06-uninstall.md) | Removes the plugin, the server and service, and optionally the state folder and the AI Office folder, each after confirmation | You no longer want AI Office |
| [07 · Contribute](07-contribute.md) | Sets up the dev loop, implements a small change tests-first, runs every check, commits and drafts a pull request | You want to send a fix or a feature |

Typical order for a new setup: 01, then 02 if you want it always on, then 04 if you have several accounts.

## How to use

1. Open Claude Code, Codex or another agent with terminal access on the computer where AI Office runs.
2. Paste the short instruction from the "How to use" section of the prompt you want.
   - **From a clone of this repository**, the instruction points at the file in your working tree: `Read docs/prompts/<file name> in this repository and execute the entire block in the "Prompt" section.`
   - **Without a clone**, the instruction points at the raw GitHub URL of the prompt file on `main` (the base is `https://raw.githubusercontent.com/tfavareto/ai-office/main/docs/prompts/`, followed by the file name) and ends with `execute the entire block in the "Prompt" section on this computer.` The remote links always follow the latest prompt on `main`.
3. Answer the agent's questions. It asks before choosing a folder, reusing anything that exists, stopping a process or deleting data.

You can also open a prompt, copy the whole block inside the `markdown` fence under "Prompt" and paste it straight into the agent.

## What every prompt guarantees

- **Explicit limits.** Each prompt lists what the agent may do and what it must ask about first: no `sudo`, no deleting or overwriting without confirmation, no pushing to a remote unless you ask.
- **The token stays secret.** The access token in `~/.ai-office/token` is never printed or requested. Where a check needs it, the command reads it without displaying it.
- **Verification and a report.** Each ends with checks such as `curl -s http://127.0.0.1:4848/api/health` returning `{"ok":true}` and `npm run plugin:status`, and a fixed final report you can read at a glance.
- **Local only.** Nothing is sent anywhere except the git clone and the npm registry during install.

Read a prompt before you run it; you are authorizing the agent to do what it lists. If an agent proposes something outside its listed limits, say no.

## Related

- [Documentation index](../README.md)
- [Installation guide](../01-installation.md) for the manual steps behind prompts 01, 02, 03 and 06
- [Troubleshooting](../08-troubleshooting.md)
- [Privacy and security](../05-privacy-and-security.md)
