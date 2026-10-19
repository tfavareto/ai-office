# Installation

This guide takes you from nothing to a running office: requirements, install from source, the Claude Code plugin, verification, updates, run at login and uninstall.

Prefer to let an agent do it? Paste [prompt 01](prompts/01-install-and-run.md) into Claude Code or Codex; it follows the steps below and asks before anything destructive.

## Requirements

| Requirement | Details |
| --- | --- |
| Operating system | macOS or Linux. Windows is not supported. |
| Node.js | Version 22 or newer (`node --version`). |
| npm | Comes with Node.js. |
| git | To clone the repository. |
| Claude Code | The CLI or the desktop app, used on the same computer. The plugin installer needs the `claude` command (see below). |
| Browser | Any current browser on the same computer. 3D needs WebGL 2. |

The plugin installer finds `claude` on your `PATH`. If it is not there, it tries `~/.local/bin/claude` and `~/.claude/local/claude`, the places the native Claude Code installer uses. Otherwise pass `--claude <path>`.

## Install from source

```sh
git clone https://github.com/tfavareto/ai-office.git
cd ai-office
npm install
npm run build
npm start
```

`npm start` runs the server in the foreground and prints `AI Office em http://127.0.0.1:4848`. Open <http://127.0.0.1:4848> in your browser. The page loads from the server you just started; keep the terminal open, or see [run at login](#run-at-login) to start it automatically.

If port 4848 is taken, start with another one: `AI_OFFICE_PORT=4900 npm start`. Prefer environment variables with `npm start`: flags do not pass through `npm start --`, so to use a flag run the bundle directly (`node packages/server/dist/index.js --port 4900`). See [configuration](04-configuration.md).

With no Claude Code session open, the page shows **Nenhuma sessão aberta** (no open session). Start `claude` in any project folder and the room appears within a few seconds.

## Install the plugin

The office already shows every session without the plugin. The plugin adds permission answers, messages to agents and the **Precisa de você** flag from Claude Code's notifications. From the repository folder:

```sh
npm run plugin:install -- --dry-run   # optional: show what would run
npm run plugin:install
```

The installer drives the public `claude plugin` command once per detected account: it adds this repository as a marketplace named `ai-office`, then installs `ai-office@ai-office` at user scope. It prints what it did and ends with "Done. Restart running Claude Code sessions to load the hooks."

**Reload the plugin in every Claude Code session that was already running:** type `/reload-plugins` in it, or restart it. Sessions started after the install pick the plugin up on their own.

Installer options (pass them after `--`):

| Option | Meaning |
| --- | --- |
| `--dry-run` | Print the commands that would change something without running them. |
| `--account <dir>` | Use this Claude config directory instead of auto-detection. Repeatable. |
| `--claude <path>` | The Claude Code executable to run. |

See [plugin](03-plugin.md#install-and-manage-the-plugin) for the manual commands and what each hook does.

## Verify

1. Health check. A running server answers without any credentials:

   ```sh
   curl -s http://127.0.0.1:4848/api/health
   ```

   Expected output: `{"ok":true}`.

2. Plugin status for every account:

   ```sh
   npm run plugin:status
   ```

   Each account prints `marketplace: added` and `plugin: installed 0.1.0 (up to date)`.

3. In the browser, the top bar shows the green connection pill **Ao vivo** (live) and the counters (**salas**, **agentes**, ...). Open a Claude Code session in a project and a room with a person appears.

4. To test permissions end to end, keep the office page open, start a session, and ask Claude Code to do something that needs approval. A **Pedido de permissão** (permission request) card appears in that agent's drawer. See [using the office](02-using-the-office.md).

Something off? See [troubleshooting](08-troubleshooting.md).

## Demo mode

Demo mode adds fictitious agents so you can explore the office without any Claude Code session. It does not touch real sessions: demo agents are shown alongside them and are excluded from **Meu dia**.

| How | Effect |
| --- | --- |
| Start the server with `AI_OFFICE_DEMO=1 npm start` (or `node packages/server/dist/index.js --demo`) | Demo starts on. |
| **Configurações** (settings), switch **Modo demonstração** (demo mode) | Turns it on or off while running. Needs the page opened on this computer. |
| The **Ver em modo demonstração** (see in demo mode) button on the empty screen | Same as the switch. |
| Open `http://127.0.0.1:4848/?mock=1` | A simulation that runs entirely in the browser, with no server data. The pill reads **Demonstração local**. |

## Update

```sh
cd /path/to/ai-office
git pull
npm install
npm run build
```

Then restart the server (stop the foreground process and run `npm start` again, or restart your service) and refresh the plugin:

```sh
npm run plugin:install
```

Restart running Claude Code sessions afterwards. Two details:

- The installer runs `claude plugin update` only when the plugin version in `packages/plugins/ai-office/.claude-plugin/plugin.json` differs from the installed one. If hooks changed without a version bump, force a clean reinstall with `npm run plugin:uninstall` followed by `npm run plugin:install`.
- The access token lives in the state directory and survives updates, so hooks keep working across a server restart.

[Prompt 03](prompts/03-update.md) does all of this for you and stops if you have local changes.

## Run at login

AI Office does not install a service on its own. Use your system's service manager to start the server at login and restart it if it stops. Replace `/path/to/ai-office` with your clone and `/absolute/path/to/node` with the output of `command -v node`. If you manage Node with nvm, fnm or similar, that path contains the Node version; update the file when you change versions.

Build first (`npm run build`), because the service runs the built bundle `packages/server/dist/index.js`.

### macOS: launchd LaunchAgent

Create `~/Library/LaunchAgents/com.ai-office.server.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.ai-office.server</string>
  <key>ProgramArguments</key>
  <array>
    <string>/absolute/path/to/node</string>
    <string>/path/to/ai-office/packages/server/dist/index.js</string>
  </array>
  <key>WorkingDirectory</key>
  <string>/path/to/ai-office</string>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>ThrottleInterval</key>
  <integer>10</integer>
  <key>StandardOutPath</key>
  <string>/Users/YOU/Library/Logs/ai-office.log</string>
  <key>StandardErrorPath</key>
  <string>/Users/YOU/Library/Logs/ai-office.log</string>
</dict>
</plist>
```

Replace `/Users/YOU` with your home folder (launchd does not expand `~`). Then load it:

```sh
launchctl bootstrap "gui/$(id -u)" ~/Library/LaunchAgents/com.ai-office.server.plist
launchctl print "gui/$(id -u)/com.ai-office.server" | head -n 12   # state = running
curl -s http://127.0.0.1:4848/api/health                           # {"ok":true}
```

Restart after an update: `launchctl kickstart -k "gui/$(id -u)/com.ai-office.server"`. Stop and disable: `launchctl bootout "gui/$(id -u)/com.ai-office.server"`.

### Linux: systemd user unit

Create `~/.config/systemd/user/ai-office.service`:

```ini
[Unit]
Description=AI Office
After=default.target

[Service]
Type=simple
WorkingDirectory=/path/to/ai-office
ExecStart=/absolute/path/to/node /path/to/ai-office/packages/server/dist/index.js
Restart=on-failure
RestartSec=5

[Install]
WantedBy=default.target
```

Then enable and start it:

```sh
mkdir -p ~/.config/systemd/user
systemctl --user daemon-reload
systemctl --user enable --now ai-office.service
systemctl --user status ai-office.service
curl -s http://127.0.0.1:4848/api/health        # {"ok":true}
```

Logs: `journalctl --user -u ai-office -f`. Restart after an update: `systemctl --user restart ai-office`. Stop and disable: `systemctl --user disable --now ai-office.service`.

The user service starts when you log in. To start it at boot without a login session, run `loginctl enable-linger "$USER"`.

To pass configuration to a service, add it to the unit (`Environment=AI_OFFICE_CLAUDE_DIRS=...` under `[Service]`) or to the plist (an `EnvironmentVariables` dictionary). See [configuration](04-configuration.md).

[Prompt 02](prompts/02-run-at-login.md) creates and verifies these files for you.

## Uninstall

Do these in order. The plugin step must come first because the installer lives in the repository folder.

1. **Plugin.** From the repository folder: `npm run plugin:uninstall`. It removes the plugin and the `ai-office` marketplace from every detected account. Restart running Claude Code sessions.
2. **Service.** If you set up run at login, stop and remove it: `launchctl bootout "gui/$(id -u)/com.ai-office.server"` and delete the plist (macOS), or `systemctl --user disable --now ai-office.service` and delete the unit (Linux).
3. **State directory.** `~/.ai-office` holds the access token, agent names and the daily **Meu dia** records. Delete it if you want a clean slate; it is recreated with a new token on the next start.
4. **The folder.** Delete the clone.

AI Office never modifies Claude Code's own files, so nothing else needs cleaning. [Prompt 06](prompts/06-uninstall.md) asks for confirmation before each destructive step.

## Next

- [Using the office](02-using-the-office.md)
- [The plugin in detail](03-plugin.md)
- [Configuration](04-configuration.md)
- [Troubleshooting](08-troubleshooting.md)
- Prompts: [01 install](prompts/01-install-and-run.md), [02 run at login](prompts/02-run-at-login.md), [03 update](prompts/03-update.md), [06 uninstall](prompts/06-uninstall.md)
