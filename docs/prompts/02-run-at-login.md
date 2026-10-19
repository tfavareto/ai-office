# Prompt 02 · Run AI Office at login

This prompt makes an agent with terminal access create a login service for the AI Office server: a launchd LaunchAgent on macOS or a systemd user service on Linux. The service starts at login, restarts if it stops, writes a log and uses absolute paths. It verifies the result and explains how to turn it off.

Use it after [prompt 01](01-install-and-run.md) when you want the office always available. The same files are described in the [installation guide](../01-installation.md#run-at-login).

## How to use

From a clone of this repository, in Claude Code or Codex:

```text
Read docs/prompts/02-run-at-login.md in this repository and execute the entire block in the "Prompt" section.
```

From any folder, without a clone:

```text
Read https://raw.githubusercontent.com/tfavareto/ai-office/main/docs/prompts/02-run-at-login.md and execute the entire block in the "Prompt" section on this computer.
```

## Prompt

```markdown
# Task: start AI Office automatically at login

You are an agent with terminal access on the user's computer (macOS or Linux). AI Office is already installed and built (see https://raw.githubusercontent.com/tfavareto/ai-office/main/docs/prompts/01-install-and-run.md). Create a per-user login service that runs the AI Office server, then verify it and report.

## Authorization and limits

You are authorized to:
- run read-only checks (`uname`, `command -v`, `ls`, `lsof`, `ps`, `curl` to 127.0.0.1, `launchctl print`, `systemctl --user status`);
- create exactly one service file, in the user's own folders:
  - macOS: `~/Library/LaunchAgents/com.ai-office.server.plist`, and the log folder `~/Library/Logs` if missing;
  - Linux: `~/.config/systemd/user/ai-office.service`;
- load or enable that one service and restart it.

You are NOT authorized to, and must ask the user first if you think it is needed:
- use `sudo`, or create system-wide services (`/Library/LaunchDaemons`, `/etc/systemd/system`);
- overwrite an existing service file (show the user a diff and ask), or kill any process;
- run `loginctl enable-linger` (it makes the service start at boot instead of at login; ask and explain);
- edit shell profiles or any file under `~/.claude*`;
- run `npm install`, `npm run build` or `git pull` without asking.

Secrets: never print, copy or ask for the contents of `~/.ai-office/token`. The service files need no secret.

If a step fails, stop and show the error with a proposal. Do not improvise destructive workarounds.

## Steps

1. Detect the platform with `uname -s`: `Darwin` means launchd, `Linux` means systemd user services. Anything else: stop.
   On Linux run `systemctl --user --version`. If it does not work (no systemd user session), stop and tell the user.

2. Locate the installation. Ask the user for the AI Office folder (propose `~/ai-office`). Call its absolute path `<dir>`; expand `~` yourself, because neither launchd nor systemd units expand it. Check that `<dir>/packages/server/dist/index.js` exists. If it does not, tell the user the project needs `npm run build` and ask permission to run it in `<dir>`.

3. Find Node.
   - `command -v node` gives `<node>`; it must be an absolute path (resolve it if needed) and `<node> --version` must be v22 or newer.
   - If `<node>` lives under a version manager folder (nvm, fnm, asdf, volta, mise), warn the user that upgrading Node changes this path and the service file must then be updated.

4. Make sure the port is free for the service.
   - `curl -s -m 3 http://127.0.0.1:4848/api/health`. If it answers `{"ok":true}`, an AI Office is already running (for instance the background one from prompt 01). Find it with `lsof -nP -iTCP:4848 -sTCP:LISTEN` and `ps -o pid,command -p <pid>`. Confirm its command line ends in `packages/server/dist/index.js`, then ask the user whether you may stop it (for example `kill <pid>`) so the service can take over. Do not stop anything else.
   - If the port is used by another program, stop and ask the user how to proceed.

5. Create the service file.

   macOS. Create `~/Library/Logs` if needed. If the plist already exists, show a diff and ask before replacing it. Write `~/Library/LaunchAgents/com.ai-office.server.plist` with the content below, replacing `<node>`, `<dir>` and `<home>` by absolute paths (no `~`). The block is indented by four spaces for display; do not write that indentation into the file:

    <?xml version="1.0" encoding="UTF-8"?>
    <!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
    <plist version="1.0">
    <dict>
      <key>Label</key>
      <string>com.ai-office.server</string>
      <key>ProgramArguments</key>
      <array>
        <string><node></string>
        <string><dir>/packages/server/dist/index.js</string>
      </array>
      <key>WorkingDirectory</key>
      <string><dir></string>
      <key>RunAtLoad</key>
      <true/>
      <key>KeepAlive</key>
      <true/>
      <key>ThrottleInterval</key>
      <integer>10</integer>
      <key>StandardOutPath</key>
      <string><home>/Library/Logs/ai-office.log</string>
      <key>StandardErrorPath</key>
      <string><home>/Library/Logs/ai-office.log</string>
    </dict>
    </plist>

   Then run `plutil -lint ~/Library/LaunchAgents/com.ai-office.server.plist`; it must print OK.

   Linux. Create `~/.config/systemd/user` if needed. If the unit already exists, show a diff and ask before replacing it. Write `~/.config/systemd/user/ai-office.service` with the content below, replacing `<node>` and `<dir>` by absolute paths (again without the four-space display indentation):

    [Unit]
    Description=AI Office
    After=default.target

    [Service]
    Type=simple
    WorkingDirectory=<dir>
    ExecStart=<node> <dir>/packages/server/dist/index.js
    Restart=on-failure
    RestartSec=5

    [Install]
    WantedBy=default.target

6. Optional settings. Ask the user whether they need a non-default port, several Claude accounts or another state folder. If yes, add them to the service as environment variables from this list: `AI_OFFICE_PORT`, `AI_OFFICE_CLAUDE_DIRS` (comma-separated, replaces auto-detection), `AI_OFFICE_STATE_DIR`. On macOS add a key `EnvironmentVariables` with a dictionary of string entries; on Linux add `Environment=NAME=value` lines under `[Service]`. If the user does not need them, add nothing. A custom port or state folder must also be set in the environment of their Claude Code sessions for the plugin hooks.

7. Load the service.
   - macOS: `launchctl bootstrap "gui/$(id -u)" ~/Library/LaunchAgents/com.ai-office.server.plist`. If it reports the service is already loaded, use `launchctl kickstart -k "gui/$(id -u)/com.ai-office.server"` instead.
   - Linux: `systemctl --user daemon-reload` then `systemctl --user enable --now ai-office.service`.

8. Verify.
   - Wait up to 10 seconds, polling `curl -s -m 2 http://127.0.0.1:4848/api/health` (use the custom port if set). It must print `{"ok":true}`.
   - macOS: `launchctl print "gui/$(id -u)/com.ai-office.server" | head -n 15` must show the job as running. Read the log with `tail -n 20 ~/Library/Logs/ai-office.log`; it should contain the line `AI Office em http://127.0.0.1:4848`.
   - Linux: `systemctl --user status ai-office.service --no-pager` must show `active (running)`; read the log with `journalctl --user -u ai-office -n 20 --no-pager`.
   - Prove the restart path once: macOS `launchctl kickstart -k "gui/$(id -u)/com.ai-office.server"`; Linux `systemctl --user restart ai-office.service`. Then check health again.
   - On Linux, ask whether the user wants the service to start at boot without logging in; only then run `loginctl enable-linger "$USER"`.

9. Tell the user how to manage it (do not run these unless asked):
   - Logs: macOS `~/Library/Logs/ai-office.log`; Linux `journalctl --user -u ai-office -f`.
   - Restart after an update: macOS `launchctl kickstart -k "gui/$(id -u)/com.ai-office.server"`; Linux `systemctl --user restart ai-office.service`.
   - Stop and disable: macOS `launchctl bootout "gui/$(id -u)/com.ai-office.server"` then delete the plist; Linux `systemctl --user disable --now ai-office.service` then delete the unit file.
   - Updating AI Office itself is prompt 03: https://raw.githubusercontent.com/tfavareto/ai-office/main/docs/prompts/03-update.md

## Verification checklist

- The service file exists with absolute paths only and passes `plutil -lint` (macOS).
- The service is running and `curl -s http://127.0.0.1:4848/api/health` prints `{"ok":true}`.
- The log shows the start-up line and no errors.
- A restart through the service manager brings the server back.

## Final report

Reply with exactly this structure and nothing secret in it:

- Platform: macOS (launchd) or Linux (systemd user).
- Files created: the path of the service file (and the log path).
- Paths used: node `<node>`, install folder `<dir>`.
- Extra settings added: none, or the variable names (not secrets).
- Service state: running or not; health `{"ok":true}` yes or no; restart test passed or not.
- What you stopped, if anything (with the user's permission).
- How to manage it: the commands from step 9.
- Problems or questions.
```

## Next

- [Prompt 03 · Update](03-update.md): restarts the service after a pull.
- [Prompt 06 · Uninstall](06-uninstall.md): removes the service.
- [Configuration](../04-configuration.md) for the variables you can add to the service.
- [Prompt catalog](README.md)
