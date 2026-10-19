# Prompt 01 · Install and run AI Office

This prompt makes an agent with terminal access install AI Office from source, start the server, install the Claude Code plugin in every account it finds and open the office in your browser. It checks the tools first, asks before reusing or overwriting anything, and never shows the access token.

Use it the first time you set up AI Office on a computer. For the same steps done by hand, see the [installation guide](../01-installation.md).

## How to use

From a clone of this repository, in Claude Code or Codex:

```text
Read docs/prompts/01-install-and-run.md in this repository and execute the entire block in the "Prompt" section.
```

From any folder, without a clone:

```text
Read https://raw.githubusercontent.com/tfavareto/ai-office/main/docs/prompts/01-install-and-run.md and execute the entire block in the "Prompt" section on this computer.
```

## Prompt

```markdown
# Task: install and run AI Office on this computer

You are an agent with terminal access on the user's computer (macOS or Linux). Install AI Office from https://github.com/tfavareto/ai-office, start it, connect its Claude Code plugin and open it in the browser. Work step by step, run the checks, and finish with the report at the end.

## Authorization and limits

You are authorized to:
- run read-only checks (versions, `command -v`, `ls`, `lsof`, `curl` to 127.0.0.1);
- `git clone` https://github.com/tfavareto/ai-office.git into the directory the user confirms;
- run `npm install` and `npm run build` inside that clone;
- create `~/.ai-office` (mode 700) and start the AI Office server in the background with its output in `~/.ai-office/server.log`;
- run `npm run plugin:install` and `npm run plugin:status` inside the clone (this calls the `claude plugin` command);
- open `http://127.0.0.1:4848` in the default browser.

You are NOT authorized to, and must ask the user first if you think it is needed:
- use `sudo`, install Node.js, system packages or global npm packages;
- edit shell profiles, system settings, or any file under `~/.claude*` other than through `npm run plugin:install`;
- overwrite, move or delete any existing file or folder, or kill any process;
- use a port other than 4848;
- push to any git remote, or send any data anywhere except the git clone and the npm registry.

Secrets: never print, copy, summarize or ask for the contents of `~/.ai-office/token`. Do not paste log lines that contain it.

If a step fails, stop, show the last relevant lines of the error and say what you propose. Do not improvise destructive workarounds.

## Steps

1. Check the platform and tools.
   - `uname -s` must be `Darwin` or `Linux`. Otherwise stop: Windows is not supported.
   - `node --version` must be v22 or newer. If it is older or missing, stop and tell the user to install a current Node.js with their usual tool; do not install it yourself.
   - Run `npm --version` and `git --version`.
   - Find the Claude Code CLI: `command -v claude`, then `claude --version`. If it is not on PATH, test `~/.local/bin/claude` and `~/.claude/local/claude` with `test -x`. Remember the path you find; you will pass it to the installer with `--claude <path>`. If there is no CLI at all, continue up to step 7, skip step 8, and say so in the report.

2. Choose the install directory.
   - Propose `~/ai-office` and wait for the user to confirm or give another path.
   - If it already exists: if `git -C <dir> remote get-url origin` points to tfavareto/ai-office and `git -C <dir> status --short` is empty, ask whether to reuse it (then skip the clone, and mention prompt 03 for updates). In every other case ask for a different directory. Never delete or overwrite.

3. Clone: `git clone https://github.com/tfavareto/ai-office.git <dir>`, then work inside `<dir>`.

4. Build.
   - `npm install`
   - `npm run build`
   Both must succeed. After a failure show the last 30 lines and stop.

5. Check the port.
   - `lsof -nP -iTCP:4848 -sTCP:LISTEN` (on Linux without lsof: `ss -ltn 'sport = :4848'`).
   - If something listens, run `curl -s -m 3 http://127.0.0.1:4848/api/health`. If it answers `{"ok":true}` an AI Office is already running: ask whether to keep using it (skip step 6) or stop. If it is some other program, ask the user to choose a free port. For a different port `<port>`, start the server in step 6 with `AI_OFFICE_PORT=<port>` and tell the user that Claude Code sessions need `AI_OFFICE_PORT=<port>` in their environment for the hooks to find the server.

6. Start the server in the background.
   - `mkdir -p -m 700 ~/.ai-office`
   - From `<dir>`: `nohup node packages/server/dist/index.js > ~/.ai-office/server.log 2>&1 &` then `echo $! > ~/.ai-office/server.pid`
   - Poll `curl -s -m 2 http://127.0.0.1:4848/api/health` for up to 10 seconds.
   - Some agent shells kill background jobs when a command returns. If the server is gone in step 7 although the log shows no error, say so and ask the user to run `cd <dir> && npm start` in their own terminal, or to use prompt 02.

7. Verify the server: `curl -s http://127.0.0.1:4848/api/health` must print `{"ok":true}`. If it does not, show `tail -n 30 ~/.ai-office/server.log` (the log holds no token) and stop.

8. Install the plugin.
   - From `<dir>`: `npm run plugin:install -- --dry-run` (add `--claude <path>` if you found the CLI off PATH). Show the user which accounts and commands it lists.
   - Then run `npm run plugin:install` with the same options.
   - Then `npm run plugin:status`. Every account must show `marketplace: added` and `plugin: installed ... (up to date)`.
   - If the installer reports "No Claude Code account found", ask the user where their Claude config folder is and pass it with `--account <dir>`.

9. Open the office: `open http://127.0.0.1:4848` on macOS, `xdg-open http://127.0.0.1:4848` on Linux. If neither works, print the URL.

10. Tell the user, in plain words:
   - In every Claude Code session that was already open (including this one, if you are running in Claude Code), type `/reload-plugins` or restart the session so it loads the plugin hooks.
   - The page should show a green **Ao vivo** pill; each open project becomes a room. Keep the tab open to answer permission requests there.
   - The server you started stops when the computer restarts or the process is killed (`kill $(cat ~/.ai-office/server.pid)` stops it).
   - To start it automatically at login, run prompt 02: Read https://raw.githubusercontent.com/tfavareto/ai-office/main/docs/prompts/02-run-at-login.md and execute the entire block in the "Prompt" section.
   Do not set up run at login unless the user asks.

## Verification checklist

- `node --version` is v22 or newer.
- `curl -s http://127.0.0.1:4848/api/health` prints `{"ok":true}`.
- `npm run plugin:status` shows the plugin installed and up to date for each account (unless the CLI was missing).
- The browser opened on `http://127.0.0.1:4848`.

## Final report

Reply with exactly this structure and nothing secret in it:

- Platform and versions: OS, Node, npm, git, Claude Code CLI (path).
- Install directory: <dir> (cloned or reused).
- Build: ok or the failing step.
- Server: running on port <port>, pid file ~/.ai-office/server.pid, log ~/.ai-office/server.log, health `{"ok":true}` yes or no.
- Plugin: accounts found and the status of each (installed and up to date, skipped, or failed with the reason).
- Browser: opened or the URL to open.
- Still to do by the user: `/reload-plugins` (or restart) in open Claude Code sessions; optional prompt 02 for run at login.
- Problems or questions.
```

## Next

- [Prompt 02 · Run at login](02-run-at-login.md)
- [Prompt 04 · Multiple accounts](04-multiple-accounts.md) if you use more than one Claude account
- [Troubleshooting](../08-troubleshooting.md) or [prompt 05](05-troubleshoot.md) if something fails
- [Prompt catalog](README.md)
