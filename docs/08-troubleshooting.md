# Troubleshooting

This guide maps symptoms to causes and fixes, then shows how to collect diagnostics when none of them fits.

Prefer an agent? [Prompt 05](prompts/05-troubleshoot.md) runs a read-only diagnosis first and asks before changing anything.

## Quick table

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| Browser cannot connect to `http://127.0.0.1:4848` | The server is not running, or uses another port. | Start it (`npm start`, or restart your service). Check `curl -s http://127.0.0.1:4848/api/health`. |
| Page is blank or "not found" | The web app was never built. | Run `npm run build` in the repository, then restart the server. |
| Pill reads **Reconnecting…** | The server stopped or restarted. | Wait a few seconds; the page reconnects by itself. If it persists, the server is down. |
| **No open sessions** while sessions are open | Sessions are in a directory the server does not watch. | [Page shows no sessions](#the-page-shows-no-sessions). |
| `A porta 4848 já está em uso` | Another process (maybe an older AI Office) holds the port. | [Port 4848 is in use](#port-4848-is-in-use). |
| `Could not run "claude"` from the installer | The `claude` CLI is not on `PATH`. | [Could not run "claude"](#could-not-run-claude). |
| No **Permission request** card appears | No local page open, plugin not loaded, or port or token mismatch. | [Permissions do not show](#permissions-do-not-show). |
| Message stays **Queued** | The agent has not run a hook yet, or the plugin is not loaded. | [Messages stay queued](#messages-stay-queued). |
| Buttons say "Only available when AI Office is opened on this computer (localhost)" | The page was opened with a non-local address. | Open `http://127.0.0.1:4848` or `http://localhost:4848` on the same computer. |
| The interface is in the wrong language | **Settings → General → Language** is set to a fixed language, or **Automatic (system)** follows a browser language you did not expect. | [The interface is in the wrong language](#the-interface-is-in-the-wrong-language). |
| 3D is slow or stutters | 3D is heavy at night, especially on laptops. | [3D is slow](#3d-is-slow). |
| A second account is missing | Its folder name or location is not auto-detected. | [Accounts not detected](#multiple-accounts-are-not-detected). |
| Hooks logged `401` or "token rejected" | An old plugin version or a token or state dir mismatch. | [Hooks get 401](#hooks-get-401-after-an-update). |

## The page shows no sessions

The pill says **Live** but the office is empty or lacks a project.

1. **No session is actually open.** A session counts as open while Claude Code's file `<config dir>/sessions/<pid>.json` exists and its process is alive. Start `claude` in a project and wait a few seconds. Closed sessions leave after a short walk to the elevator.
2. **The account is not watched.** The server auto-detects `~/.claude` and `~/.claude-<name>` directories that contain `projects/`. A directory with another name or location is ignored. Set `AI_OFFICE_CLAUDE_DIRS` (it replaces auto-detection, so list every account) and restart the server. See [configuration](04-configuration.md#multiple-accounts).
3. **The server runs as a different user or with a different `HOME`.** A service started from another environment may look in another home folder. Check the account directories in the authenticated health output (see [how to collect diagnostics](#how-to-collect-diagnostics)).
4. **Older Claude Code without the session registry.** Accounts without a `sessions/` directory fall back to transcripts modified in the last 30 minutes. A session idle for longer than that disappears.
5. **Demo mode hides nothing, but adds noise.** If you see fictitious agents, turn **Demo mode** off in **Settings**.

## Hooks get 401 after an update

Hooks that cannot authenticate behave as if AI Office were offline: permission cards and message delivery silently stop working, and nothing breaks in the session.

Causes and fixes:

- **An old cached plugin.** A plugin version from before the access token was introduced sends no token, so the server answers 401. Update it from the repository folder and restart sessions:

  ```sh
  npm run plugin:uninstall
  npm run plugin:install
  ```

  Then restart every running Claude Code session. The installer only runs `claude plugin update` when the plugin version differs, so a clean uninstall and install is the reliable way to refresh hooks that changed without a version bump.
- **State directory mismatch.** If the server runs with `--state-dir` or `AI_OFFICE_STATE_DIR`, Claude Code needs the same `AI_OFFICE_STATE_DIR` in its environment so the hooks find the `token`.
- **Token rotated.** Hooks reread the file on every run, so a new token is picked up. If the *page* shows errors after you rotated it, reload the page to get a new cookie.

Confirm with hook debug logging (below): the log shows `-> 401, token rejected` or `no access token`.

## Could not run "claude"

The installer prints `Could not run "claude". Install the Claude Code CLI and make sure it is on your PATH, or pass --claude <path>.`

- Find the CLI: `command -v claude`. The native installer puts it at `~/.local/bin/claude` (the installer already tries that and `~/.claude/local/claude`).
- If it exists but is not on `PATH` in this shell, pass it: `npm run plugin:install -- --claude ~/.local/bin/claude`.
- If you only use the desktop app and have no CLI, install the Claude Code CLI first, since the plugin install goes through `claude plugin`.

## Port 4848 is in use

The server stops with `A porta 4848 já está em uso. Use AI_OFFICE_PORT ou --port.`

1. See who owns the port: `lsof -nP -iTCP:4848 -sTCP:LISTEN`.
2. If it is an older AI Office (the command line ends in `packages/server/dist/index.js`, or `curl -s http://127.0.0.1:4848/api/health` answers `{"ok":true}`), stop it. If it is a service, stop the service instead of killing the process, or it will restart.
3. If another program owns the port, pick a free one: `AI_OFFICE_PORT=4900 npm start`. Then set `AI_OFFICE_PORT=4900` in the environment of your Claude Code sessions so the hooks reach the server, and restart those sessions.

## Permissions do not show

A permission request is routed to the office only when all of these hold:

| Condition | How to check or fix |
| --- | --- |
| A page is open **on this computer**. With no page open the server answers "skip" and the terminal dialog is used. | Keep the office tab open at `http://127.0.0.1:4848`. A tab opened through a LAN address or hostname is not local. |
| The plugin is installed in **that session's account**. | `npm run plugin:status`; install with `npm run plugin:install`. |
| The session **loaded the plugin**: it started after the install, or ran `/reload-plugins`. | Run `/reload-plugins` in the session, or restart it. |
| The hooks reach the server: same port and same token. | Match `AI_OFFICE_PORT` and `AI_OFFICE_STATE_DIR` between server and Claude Code. See [hooks get 401](#hooks-get-401-after-an-update). |
| The agent is known to the office. | The session must appear in the office. A request from an unknown session is skipped. |
| It is not a question. `AskUserQuestion` is a question, not a permission; answer it in the terminal. The **Needs you** card offers **Answer in the terminal**. | None needed. |
| It was not already answered. If you answered in the terminal first, the card is withdrawn. | None needed. |

A request also expires: after 5 minutes (or `AI_OFFICE_PERMISSION_TIMEOUT` if lower) the terminal dialog takes over.

## Messages stay queued

**Queued** means no hook has asked for the message yet.

- **The plugin is not loaded** in that session: install it, then restart the session. See [plugin](03-plugin.md#install-and-manage-the-plugin).
- **The agent is idle and not on stand-by.** Messages are delivered after a tool call, when a turn ends, or during stand-by. Stand-by only runs when a page is open on this computer, lasts at most `AI_OFFICE_STANDBY_MIN` minutes (default 10, `0` disables) and ends early if the server says skip. After it ends, an idle agent will not ask again until it does something, such as a new prompt.
- **No local page.** Stand-by waits only while a page is connected, and the composer only works on a local page.
- **The message expired.** Queued messages expire after 2 hours and show **Expired**.

To wake an idle agent, send the message while its turn is ending or during stand-by, or give it a prompt in the terminal; the queued message is delivered at the next hook.

## 3D is slow

3D draws a full lit scene, so it needs far more from your GPU than 2D. The night scene is the most expensive (bloom plus anti-aliasing at a high pixel ratio). See [evidence and limits](06-validation.md#frame-rate-measurements).

- Switch to **2D**: **Settings**, **Visual**, **2D**. It is the default and stays smooth even on modest hardware.
- Set **Day and night** to **Day** instead of **Automatic** in the evening.
- On a laptop, plug in and turn off Low Power Mode, which caps the display at 30 fps.
- Close other GPU-heavy tabs and prefer a Chromium-based browser, the one the measurements used.

## The interface is in the wrong language

The language is a per-browser preference, so a different browser, a private window or cleared site data can show another language than the one you chose.

1. Open **Settings** (the gear in the top bar) and look at **Language**. The change is instant, and the panels, the signs inside the office and the notifications all follow it.
2. If it says **Automatic (system)**, the page uses the first supported language in your browser's language list: Portuguese gives Português, Spanish gives Español, anything else gives English. Reorder or add languages in the browser settings, or pick a fixed language in **Settings → General → Language**.
3. Text from your own sessions (prompts, task titles, commands, file names) is shown as written and is never translated, so it can differ from the interface language. The same goes for the conversation in the terminal panel.
4. A few messages stay in Portuguese on purpose: the status lines Claude Code shows while a plugin hook waits ("Aguardando resposta no AI Office", "De plantão: aguardando ordens no AI Office") and the server's command-line messages such as "A porta 4848 já está em uso".
5. The wording the agent receives (the reason added to a denial and the preamble before your messages) follows the language the page had when you answered or sent. If it is in Portuguese while the interface is not, a plugin version from before the language support is probably still cached: refresh it (the steps in [hooks get 401](#hooks-get-401-after-an-update)) and restart the sessions.

## Multiple accounts are not detected

- Check the folder names. Auto-detection finds `~/.claude` and `~/.claude-<name>` with a `projects/` folder inside. A folder like `~/.claude.work`, or one outside your home, is not found by the server.
- Set `AI_OFFICE_CLAUDE_DIRS` to a comma-separated list of every account, including `~/.claude`, and restart the server.
- The plugin installer reads `AI_OFFICE_CLAUDE_DIRS` too; or use `--account <dir>` (repeatable). Then run `npm run plugin:status` to confirm each account.
- A brand-new account appears within about 10 seconds. An account whose `projects/` folder does not exist yet (never used) is not detected until Claude Code creates it.

[Prompt 04](prompts/04-multiple-accounts.md) does this step by step.

## How to collect diagnostics

**Server log.** Start with `AI_OFFICE_LOG=debug npm start` (or `node packages/server/dist/index.js --debug`). It prints skipped lines and discovery diagnostics to standard error. Under a service, read the service log (macOS: the log file named in the plist, for example `~/Library/Logs/ai-office.log`; Linux: `journalctl --user -u ai-office -f`).

**Health, without and with the token.**

```sh
curl -s http://127.0.0.1:4848/api/health
printf 'Authorization: Bearer %s\n' "$(cat ~/.ai-office/token)" | curl -s -H @- http://127.0.0.1:4848/api/health
```

The first prints `{"ok":true}`. The second reads the token without printing it and returns the version, whether the request counted as local, whether demo is on, and each watched account with its directory and session count. Redact paths before sharing the output. Never paste the token itself.

**Plugin status.** `npm run plugin:status` lists, for each account, whether the marketplace is added and the plugin version.

**Hook logs.** Set `AI_OFFICE_HOOK_DEBUG=1` in the environment that launches Claude Code, restart the session and run it with `claude --debug`. Each hook then logs lines like `[ai-office:permission] POST /api/permissions -> 200` to standard error.

**Browser.** Open the developer console. `window.aiOffice.debug()` returns the connection state, the snapshot revision and the renderer's counters. Opening `http://127.0.0.1:4848/?mock=1` runs the office with no server; if that works but the live page does not, the problem is on the server or connection side.

**State directory permissions.** `ls -ld ~/.ai-office` should show `drwx------` and `ls -l ~/.ai-office/token` should show `-rw-------`.

If you still cannot find the cause, open an issue with your OS, Node.js and Claude Code versions, the redacted output above and what you expected. For anything security related, follow [SECURITY.md](../SECURITY.md) instead.

## Next

- [Installation](01-installation.md)
- [Plugin](03-plugin.md)
- [Configuration](04-configuration.md)
- [Prompt 05 · Troubleshoot](prompts/05-troubleshoot.md)
