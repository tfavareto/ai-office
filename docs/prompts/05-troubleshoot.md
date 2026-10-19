# Prompt 05 · Troubleshoot AI Office

This prompt makes an agent with terminal access diagnose a misbehaving AI Office. It starts with a read-only diagnosis (versions, health, port, token file permissions, plugin status per account, logs), explains what it found, proposes fixes, and applies only the ones you approve one at a time.

Use it when the office is empty, permissions or messages do not work, the server will not start, or 3D feels slow. The symptom tables are in the [troubleshooting guide](../08-troubleshooting.md).

## How to use

From a clone of this repository, in Claude Code or Codex:

```text
Read docs/prompts/05-troubleshoot.md in this repository and execute the entire block in the "Prompt" section.
```

From any folder, without a clone:

```text
Read https://raw.githubusercontent.com/tfavareto/ai-office/main/docs/prompts/05-troubleshoot.md and execute the entire block in the "Prompt" section on this computer.
```

## Prompt

```markdown
# Task: diagnose and fix AI Office

You are an agent with terminal access on the user's computer (macOS or Linux). AI Office (https://github.com/tfavareto/ai-office) is installed but something does not work. First ask the user to describe the symptom in one or two sentences. Then diagnose without changing anything, explain, propose fixes and apply only what the user approves.

## Authorization and limits

Phase A (diagnosis) is read-only. You are authorized to run: version commands, `command -v`, `ls`, `stat`, `test`, `lsof`, `ps`, `tail` on AI Office logs, `curl` to 127.0.0.1, `git status` and `git log` in the AI Office folder, `npm run plugin:status`, `launchctl print` / `systemctl --user status` / `journalctl --user` for the AI Office service.

Phase C (fixes) needs the user's explicit "yes" for each fix, one at a time. Even after a yes you must NOT: use `sudo`, delete `~/.ai-office` or any `~/.claude*` content, discard local git changes, change system or security settings, edit shell profiles, push to a remote, or kill any process other than the AI Office server.

Secrets: never print, copy or ask for the contents of `~/.ai-office/token`, and never read transcripts (`projects/**/*.jsonl`). Redact home folder names from anything you quote if the user will share the report.

## Phase A: read-only diagnosis

Run these and keep the results. Skip a check that does not apply and say so.

1. Platform and tools: `uname -s`, `node --version` (must be v22 or newer), `npm --version`, `git --version`, `command -v claude` and `claude --version` (if absent, look for `~/.local/bin/claude` and `~/.claude/local/claude`).
2. Installation: ask for the AI Office folder (propose `~/ai-office`), call it `<dir>`. Then `git -C <dir> rev-parse --short HEAD`, `git -C <dir> status --short`, and `ls -l <dir>/packages/server/dist/index.js <dir>/packages/web/dist/index.html` (both must exist; if not, the project needs `npm run build`).
3. Server and port: `lsof -nP -iTCP:4848 -sTCP:LISTEN` (Linux without lsof: `ss -ltnp 'sport = :4848'`), the owner command line with `ps -o pid,command -p <pid>`, and `curl -s -m 3 http://127.0.0.1:4848/api/health` (expect `{"ok":true}`). Also check whether the user set `AI_OFFICE_PORT` (`printenv AI_OFFICE_PORT`) and use that port instead if so.
4. Access token and state folder, permissions only: macOS `stat -f '%Lp %N' ~/.ai-office ~/.ai-office/token`, Linux `stat -c '%a %n' ~/.ai-office ~/.ai-office/token`. Expected 700 and 600. Never `cat` the token.
5. What the server sees, with the token read but not printed:
   `printf 'Authorization: Bearer %s\n' "$(cat ~/.ai-office/token)" | curl -s -m 3 -H @- http://127.0.0.1:4848/api/health`
   This returns the version, `local`, `demo` and the watched `accounts` with their `dir` and `sessions` count. Compare with the real `~/.claude*` folders: `ls -d ~/.claude* 2>/dev/null` and `test -d <folder>/projects` for each.
6. Plugin per account: `npm run plugin:status` in `<dir>` (add `--claude <path>` if the CLI is off PATH). Expected for each account: `marketplace: added` and `plugin: installed ... (up to date)`.
7. Service, if any: macOS `launchctl print "gui/$(id -u)/com.ai-office.server" | head -n 20`; Linux `systemctl --user status ai-office.service --no-pager`. And the last log lines: `tail -n 30 ~/.ai-office/server.log`, `tail -n 30 ~/Library/Logs/ai-office.log`, or `journalctl --user -u ai-office -n 30 --no-pager`. Look for `Porta` / `porta`, `EADDRINUSE`, `Recusando`, `[erro]`.
8. Environment that affects the plugin: `printenv AI_OFFICE_PORT AI_OFFICE_STATE_DIR AI_OFFICE_CLAUDE_DIRS AI_OFFICE_STANDBY_MIN AI_OFFICE_PERMISSION_TIMEOUT AI_OFFICE_HOOK_DEBUG` (it is fine if they are empty).
9. Browser hints (ask the user, do not drive their browser): is the pill green "Live" (or "Ao vivo" / "En vivo", the interface follows the browser language, which can be changed in Settings → Language)? What does the browser console show? Does `http://127.0.0.1:4848/?mock=1` render an office (it runs without the server)? Is the tab opened through `127.0.0.1` or `localhost`, not a hostname or LAN address? Which visual (2D or 3D) is selected, and is the laptop in Low Power Mode?

## Phase B: explain

Summarize in plain words what is healthy, what is wrong and the most likely cause, mapped to the symptom. Use these known causes:
- Server not running or built: no listener on the port, or `dist/` files missing.
- Port taken by something else: the log says the port is in use.
- Account not watched: a `~/.claude*` folder with `projects/` is missing from the `accounts` list (non-standard name or location).
- Plugin missing or stale in an account, or sessions started before it was installed (restart them).
- Hooks cannot authenticate: token or state folder mismatch (`AI_OFFICE_STATE_DIR`), port mismatch (`AI_OFFICE_PORT`), or an old cached plugin version (hooks log 401).
- Permissions not shown: no AI Office page open on this computer, or the page opened through a non-local address.
- Messages stay "Queued" (the status label depends on the interface language): plugin not loaded in that session, or the agent is idle with no stand-by (stand-by needs an open local page and lasts at most 10 minutes).
- 3D slow: 3D at night is heavy, especially in Low Power Mode; 2D is the default.

## Phase C: propose and apply fixes

List the fixes in order, each with: what it does, the exact command, and the risk. Ask "Apply fix N?" and wait for a yes before each one. Typical fixes:
- build: `npm run build` in `<dir>`, then restart the server;
- start or restart the server (service restart command, or `nohup node packages/server/dist/index.js > ~/.ai-office/server.log 2>&1 &` from `<dir>`);
- another port: `AI_OFFICE_PORT=<port>` for the server, and the same variable in the user's Claude Code environment;
- watch more accounts: `AI_OFFICE_CLAUDE_DIRS=<comma-separated folders>` (prompt 04: https://raw.githubusercontent.com/tfavareto/ai-office/main/docs/prompts/04-multiple-accounts.md);
- plugin: `npm run plugin:install`, or `npm run plugin:uninstall` then `npm run plugin:install` for a clean reinstall; then the user restarts their Claude Code sessions;
- token file permissions: `chmod 700 ~/.ai-office && chmod 600 ~/.ai-office/token`;
- hook debug logging: ask the user to set `AI_OFFICE_HOOK_DEBUG=1` in the environment that starts Claude Code and to run `claude --debug`, then read the `[ai-office:...]` lines they paste (never ask for a token);
- server debug logging: restart with `AI_OFFICE_LOG=debug`.
After each fix, re-run the relevant Phase A check and say whether it is resolved.

## Final report

Reply with exactly this structure and nothing secret in it:

- Symptom as described by the user.
- Findings: platform and versions, install folder and commit, server state and port, token file permissions (only the modes), accounts watched versus accounts found, plugin status per account, service state, notable log lines (redacted).
- Diagnosis: the most likely cause and the evidence.
- Fixes applied (with the user's approval) and their result; fixes declined or still pending.
- What the user must do next (for example restart Claude Code sessions, reload the tab).
- If unresolved: what to include in a GitHub issue (versions, redacted health output, redacted log lines) and a reminder to report security problems privately as described in SECURITY.md.
```

## Next

- [Troubleshooting guide](../08-troubleshooting.md)
- [Privacy and security](../05-privacy-and-security.md) before sharing any output
- [Prompt catalog](README.md)
