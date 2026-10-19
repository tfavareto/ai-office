# Prompt 03 · Update AI Office

This prompt makes an agent with terminal access update an existing AI Office installation: pull the latest code, reinstall dependencies, rebuild, restart the server (service or background process), refresh the Claude Code plugin and verify. It stops at once if you have local changes, and never discards anything.

Use it whenever you want the latest version. The manual version is in the [installation guide](../01-installation.md#update).

## How to use

From a clone of this repository, in Claude Code or Codex:

```text
Read docs/prompts/03-update.md in this repository and execute the entire block in the "Prompt" section.
```

From any folder, without a clone:

```text
Read https://raw.githubusercontent.com/tfavareto/ai-office/main/docs/prompts/03-update.md and execute the entire block in the "Prompt" section on this computer.
```

## Prompt

```markdown
# Task: update AI Office to the latest version

You are an agent with terminal access on the user's computer (macOS or Linux). AI Office is already installed from https://github.com/tfavareto/ai-office. Update it safely, restart it, refresh its Claude Code plugin, verify and report.

## Authorization and limits

You are authorized to:
- run read-only checks (git status and log, versions, `lsof`, `ps`, `curl` to 127.0.0.1, service status commands);
- in the AI Office folder: `git fetch`, `git pull --ff-only`, `npm install`, `npm run build`;
- restart the AI Office server: through its login service (launchd label `com.ai-office.server` or systemd user unit `ai-office`) if one exists, otherwise by stopping the background process only after the user agrees and starting it again the same way as before;
- run `npm run plugin:install` and `npm run plugin:status`; and `npm run plugin:uninstall` followed by `npm run plugin:install` only if the user agrees in step 7.

You are NOT authorized to, and must ask the user first if you think it is needed:
- discard, stash, reset or overwrite local changes, switch branches, rebase, or force anything;
- use `sudo`, edit shell profiles, or touch files under `~/.claude*` other than through the plugin installer;
- kill any process other than the AI Office server, or delete `~/.ai-office`;
- push to any remote.

Secrets: never print, copy or ask for the contents of `~/.ai-office/token`.

If a step fails, stop and show the last relevant lines with a proposal. Do not improvise destructive workarounds.

## Steps

1. Locate the installation. Ask for the AI Office folder (propose `~/ai-office`); call it `<dir>`. It must contain `package.json` whose name is `ai-office` and a `.git` folder. Otherwise stop.

2. Check that the working tree is clean.
   - `git -C <dir> status --short` must print nothing. If it prints anything, STOP. Show the list, explain that you will not stash or discard it, and let the user decide. Do not continue.
   - `git -C <dir> rev-parse --abbrev-ref HEAD` should be `main`. If not, ask before continuing.

3. Record the starting point: `git -C <dir> rev-parse --short HEAD` and the plugin version from `<dir>/packages/plugins/ai-office/.claude-plugin/plugin.json` (the `version` field, for example with `node -p`).

4. Fetch and show what is new.
   - `git -C <dir> fetch origin`
   - `git -C <dir> log --oneline HEAD..origin/main` lists the new commits. If it is empty, tell the user AI Office is already up to date and ask whether to continue with a rebuild and restart anyway.
   - `git -C <dir> pull --ff-only`. If this fails because histories diverged, stop and report; do not merge or rebase.

5. Install and build, in `<dir>`: `npm install`, then `npm run build`. Both must succeed. After a failure show the last 30 lines and stop.

6. Restart the server.
   - macOS service: `launchctl print "gui/$(id -u)/com.ai-office.server"` succeeds means a service exists; restart with `launchctl kickstart -k "gui/$(id -u)/com.ai-office.server"`.
   - Linux service: `systemctl --user is-active ai-office.service` prints `active` means a service exists; restart with `systemctl --user restart ai-office.service`.
   - No service: find the process with `lsof -nP -iTCP:4848 -sTCP:LISTEN` and `ps -o pid,command -p <pid>`. Only if its command line ends in `packages/server/dist/index.js`, ask the user whether you may stop it, and ask whether it was started with special settings (a port, `AI_OFFICE_CLAUDE_DIRS`, `AI_OFFICE_STATE_DIR`, `AI_OFFICE_DEMO`) that you must repeat. Then stop it and start it again from `<dir>` with the same settings: `nohup node packages/server/dist/index.js > ~/.ai-office/server.log 2>&1 &`, saving the pid with `echo $! > ~/.ai-office/server.pid`.
   - If nothing is running, start it the same way and tell the user.

7. Refresh the plugin.
   - Compare the plugin version now with the one recorded in step 3, and run `git -C <dir> diff --stat <old-commit> HEAD -- packages/plugins/ai-office` to see whether the hooks changed.
   - Run `npm run plugin:install` in `<dir>` (add `--claude <path>` if the CLI is not on PATH; check `~/.local/bin/claude` and `~/.claude/local/claude`). The installer updates the plugin only when its version changed.
   - If the hooks changed but the version did not, explain that Claude Code may keep the old cached copy, and ask whether to run `npm run plugin:uninstall` and then `npm run plugin:install` for a clean reinstall.
   - Run `npm run plugin:status`; each account must show `plugin: installed ... (up to date)`.

8. Verify.
   - `curl -s http://127.0.0.1:4848/api/health` prints `{"ok":true}` (use the custom port if one is set).
   - `ls -l <dir>/packages/web/dist/index.html <dir>/packages/server/dist/index.js` show fresh files.
   - The server log or service log has no errors (`tail -n 20 ~/.ai-office/server.log`, `tail -n 20 ~/Library/Logs/ai-office.log` or `journalctl --user -u ai-office -n 20 --no-pager`).

9. Tell the user: restart every running Claude Code session so it loads the updated hooks, and reload the AI Office tab in the browser.

## Verification checklist

- Working tree was clean before the update and the pull was a fast-forward.
- `npm install` and `npm run build` succeeded.
- The server restarted and health prints `{"ok":true}`.
- `npm run plugin:status` shows the plugin up to date for each account.

## Final report

Reply with exactly this structure and nothing secret in it:

- Folder: <dir>.
- Version: commit before and after, plugin version before and after, number of new commits.
- Local changes: none (otherwise the update was stopped at step 2).
- Build: ok or the failing step.
- Server: restarted through service / process, health yes or no.
- Plugin: status per account; clean reinstall done or not.
- Still to do by the user: restart Claude Code sessions; reload the browser tab.
- Problems or questions.
```

## Next

- [Prompt 05 · Troubleshoot](05-troubleshoot.md) if something fails after the update.
- [Plugin guide](../03-plugin.md#install-and-manage-the-plugin) for what the installer does.
- [Prompt catalog](README.md)
