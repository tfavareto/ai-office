# Prompt 06 · Uninstall AI Office

This prompt makes an agent with terminal access remove AI Office in a safe order: the Claude Code plugin first, then the running server and its login service, and only if you confirm each one, the state folder `~/.ai-office` and the AI Office folder itself. Every destructive step needs your explicit confirmation, and Claude Code's own files are never touched.

Use it when you want AI Office gone from this computer. The manual version is in the [installation guide](../01-installation.md#uninstall).

## How to use

From a clone of this repository, in Claude Code or Codex:

```text
Read docs/prompts/06-uninstall.md in this repository and execute the entire block in the "Prompt" section.
```

From any folder, without a clone:

```text
Read https://raw.githubusercontent.com/tfavareto/ai-office/main/docs/prompts/06-uninstall.md and execute the entire block in the "Prompt" section on this computer.
```

## Prompt

```markdown
# Task: uninstall AI Office

You are an agent with terminal access on the user's computer (macOS or Linux). Remove AI Office step by step. Each step that deletes or stops something needs the user's explicit "yes" for that step; a "yes" to one step is not a "yes" to the next. Order matters: the plugin must be removed before the folder is deleted, because the installer lives in that folder.

## Authorization and limits

You are authorized to run read-only checks at any time: `ls`, `du -sh`, `git status`, `lsof`, `ps`, `launchctl print`, `systemctl --user status`, `npm run plugin:status`.

Everything below needs a separate explicit confirmation from the user, asked right before it and showing exactly what will be affected:
- `npm run plugin:uninstall` (after a `--dry-run` preview);
- stopping the AI Office server process or service, and deleting its service file;
- deleting the state folder `~/.ai-office`;
- deleting the AI Office folder.

You must NEVER: delete or modify anything under `~/.claude*` yourself (the plugin installer removes only the plugin and its marketplace entry through the `claude plugin` command), use `sudo`, delete any folder you have not verified as described below, run `rm -rf` on a path built from an unchecked variable or from `/`, `~` or a home folder alone, or push to a remote.

Secrets: never print, copy or ask for the contents of `~/.ai-office/token`.

If a step fails, stop and show the error with a proposal.

## Steps

1. Locate and inspect.
   - Ask for the AI Office folder (propose `~/ai-office`); call it `<dir>`. Verify it: `<dir>/package.json` has name `ai-office` and `<dir>/packages/plugins/scripts/install.mjs` exists. If not, stop.
   - Show the user what exists: `du -sh <dir> ~/.ai-office 2>/dev/null`, `git -C <dir> status --short` and `git -C <dir> log --oneline @{u}..HEAD 2>/dev/null` (local uncommitted changes or unpushed commits that deleting the folder would lose), `npm run plugin:status` in `<dir>`, and whether a service exists (macOS `~/Library/LaunchAgents/com.ai-office.server.plist`; Linux `~/.config/systemd/user/ai-office.service`) and whether something listens on port 4848 (`lsof -nP -iTCP:4848 -sTCP:LISTEN`).
   - Present a plan of what you would remove and ask which parts the user wants removed: plugin, server and service, state folder, AI Office folder.

2. Plugin. If the user wants it removed:
   - run `npm run plugin:uninstall -- --dry-run` in `<dir>` (add `--claude <path>` if the CLI is not on PATH; look in `~/.local/bin/claude` and `~/.claude/local/claude`) and show the commands per account;
   - ask for confirmation, then run `npm run plugin:uninstall` with the same options;
   - run `npm run plugin:status`; each account must show `plugin: not installed` and `marketplace: not added`.
   Tell the user to restart running Claude Code sessions.

3. Server and service. If the user wants it removed:
   - If a service exists: confirm, then macOS `launchctl bootout "gui/$(id -u)/com.ai-office.server"`, Linux `systemctl --user disable --now ai-office.service`. Then ask separately before deleting the service file (`~/Library/LaunchAgents/com.ai-office.server.plist` or `~/.config/systemd/user/ai-office.service`) and the log `~/Library/Logs/ai-office.log` on macOS; on Linux after deleting the unit run `systemctl --user daemon-reload`.
   - If a background process listens on 4848: show `ps -o pid,command -p <pid>`; only if the command line ends in `packages/server/dist/index.js`, confirm and stop it with `kill <pid>`. Never stop anything else.
   - Check that `curl -s -m 3 http://127.0.0.1:4848/api/health` no longer answers.

4. State folder `~/.ai-office`. It holds the access token, agent names, daily "Meu dia" records and possibly `server.log` and `server.pid`. If the user wants it deleted:
   - list it with `ls -la ~/.ai-office` (never read the token);
   - confirm that the server is stopped;
   - ask the user to confirm deleting exactly that path;
   - then `rm -r -- "$HOME/.ai-office"` (resolve the absolute path first and check it ends in `/.ai-office`).
   If the user used a custom state folder (`AI_OFFICE_STATE_DIR`), apply the same care to that exact path only.

5. AI Office folder `<dir>`. If the user wants it deleted:
   - repeat the `git status --short` and unpushed-commit checks; if there is anything, warn clearly that it will be lost and ask again;
   - verify the path is the absolute path of the folder you checked in step 1, is not `/`, not the home folder, and not a parent of it;
   - ask the user to confirm deleting that exact path, then `rm -r -- "<absolute dir>"`.
   If the plugin from step 2 was not removed first, stop and do step 2 before deleting the folder.

6. Verify what is left, read-only: `ls -d <dir> ~/.ai-office 2>&1`, `curl -s -m 3 http://127.0.0.1:4848/api/health` (should fail to connect), and the service file paths. Do not look inside `~/.claude*`.

## Final report

Reply with exactly this structure and nothing secret in it:

- Removed (with the user's confirmation): plugin (per account), server or service (and its file), state folder, AI Office folder. Say "kept" for anything the user chose to keep.
- Not touched: Claude Code's own files under `~/.claude*`.
- Verification: plugin status per account, port 4848 free yes or no, paths that no longer exist.
- Still to do by the user: restart Claude Code sessions so the hooks are gone.
- Problems or questions.
```

## Next

- [Prompt 01 · Install and run](01-install-and-run.md) to install again.
- [Installation guide: uninstall](../01-installation.md#uninstall)
- [Prompt catalog](README.md)
