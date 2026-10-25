# Configuration

This guide lists every setting of the server and the plugin hooks, explains how accounts are discovered, what lives in the state directory, and how demo and development modes work.

AI Office needs no configuration file. Settings come from environment variables or command-line flags; a flag wins over its environment variable. Interface preferences (language, 2D or 3D, day and night, sounds) are not server settings: they live in your browser. See [interface preferences](#interface-preferences) below.

## Server settings

Set an environment variable in front of the command, or run the bundle directly with flags:

```sh
AI_OFFICE_PORT=4900 npm start
node packages/server/dist/index.js --port 4900 --debug
```

Flags do not pass through `npm start --`; use environment variables with `npm start`, or run `node packages/server/dist/index.js` yourself.

| Environment variable | Flag | Default | Meaning |
| --- | --- | --- | --- |
| `AI_OFFICE_PORT` | `--port <n>` | `4848` | TCP port (1 to 65535). An invalid value stops the server with "Porta inválida" (the server's command-line messages are in Portuguese). |
| `AI_OFFICE_HOST` | `--host <addr>` | `127.0.0.1` | Address to bind. Anything that is not a loopback address is refused unless remote access is allowed (below). |
| `AI_OFFICE_ALLOW_REMOTE` | `--allow-remote` | off | Accept a non-loopback `AI_OFFICE_HOST`. Even then, browsers cannot sign in remotely. See [privacy and security](05-privacy-and-security.md#remote-access). |
| `AI_OFFICE_CLAUDE_DIRS` | `--claude-dirs <list>` | auto-discovery | Comma-separated Claude config directories to watch. Replaces auto-discovery entirely. `~` is expanded. |
| `AI_OFFICE_CODEX_DIRS` | `--codex-dirs <list>` | none | Comma-separated extra Codex homes to follow, besides `CODEX_HOME` (or `~/.codex`). `~` is expanded. See [Codex sessions](#codex-sessions). |
| `AI_OFFICE_CODEX` | none | on | Set to `0` or `false` to never read Codex sessions; **Settings → Show Codex sessions** then cannot turn it on. |
| `AI_OFFICE_TEAM` | none | on | Set to `0` or `false` to remove [team mode](#team-mode): **Settings → Team mode** then cannot be turned on. |
| `AI_OFFICE_TEAM_LOOPBACK` | none | off | Let a team use `127.0.0.1` (two AI Office instances on one computer, for tests and demos). Normally only LAN addresses are offered. |
| `AI_OFFICE_TEAM_DEVICE` | none | a neutral label (`PC-3f9a`) | The device name team mode shows for this computer (at most 32 characters; the dialog's own field wins). The computer's host name is never used. |
| `CODEX_HOME` | none | `~/.codex` | The Codex CLI's own variable: where Codex keeps its sessions. AI Office honors it. |
| `AI_OFFICE_STATE_DIR` | `--state-dir <dir>` | `~/.ai-office` | Where the server keeps its token, agent names and daily records. |
| `AI_OFFICE_DEMO` | `--demo` | off | Start with demo mode on (`1`, or any value except empty, `0` or `false`). |
| `AI_OFFICE_WEB_DIR` | `--web-dir <dir>` | `packages/web/dist` | Folder with the built web app to serve. |
| `AI_OFFICE_LOG` | `--quiet`, `--debug` | `info` | `quiet` prints errors only; `debug` adds diagnostics such as skipped transcript lines. If both flags are given, `--debug` wins. |

Flags accept `--flag value` and `--flag=value`; boolean flags (`--demo`, `--quiet`, `--debug`, `--allow-remote`) need no value. An unknown flag stops the server with an error. Relative paths are resolved against the current directory.

Examples:

```sh
# Another port, and only one account
AI_OFFICE_PORT=4900 AI_OFFICE_CLAUDE_DIRS=~/.claude-work npm start

# Diagnostics while investigating a problem
AI_OFFICE_LOG=debug npm start

# Try the office with fictitious agents
AI_OFFICE_DEMO=1 npm start
```

The server also reads `CLAUDE_CONFIG_DIR` (adds that directory as an account when auto-discovering) and `HOME`.

## Plugin hook settings

The hooks run inside Claude Code, so these variables must be set in the environment that launches your Claude Code sessions (your shell profile for the CLI). Restart the sessions after changing them.

| Variable | Default | Meaning |
| --- | --- | --- |
| `AI_OFFICE_PORT` | `4848` | Port of the AI Office server. Set it when the server uses another port. |
| `AI_OFFICE_STATE_DIR` | `~/.ai-office` | Folder holding the server's `token`. Set it when the server uses `--state-dir`. Without a readable token the hooks behave as if AI Office were offline. |
| `AI_OFFICE_PERMISSION_TIMEOUT` | `300` | Seconds to wait for a permission answer. Clamped to 5 to 1800; effectively at most 300, because the server expires requests after 5 minutes and the hook timeout is 330 s. |
| `AI_OFFICE_STANDBY_MIN` | `10` | Minutes the `Stop` hook waits on stand-by for a message. 0 to 10; `0` disables stand-by. |
| `AI_OFFICE_HOOK_DEBUG` | unset | `1` makes each hook log what it does to stderr, prefixed `[ai-office:<hook>]`. Claude Code shows hook stderr in its debug output (`claude --debug`). |

The hooks always connect to `127.0.0.1`; there is no host setting. Details of each hook are in [plugin](03-plugin.md).

## Interface preferences

The interface settings in **Settings** are saved by the page in your browser's `localStorage` under the key `ai-office:prefs`. The server never sees or stores them, so each browser keeps its own. Each field is validated when it is loaded; anything invalid falls back to its default.

| Field | Values | Default |
| --- | --- | --- |
| `language` | `auto`, `pt-BR`, `en`, `es` | `auto` |
| `visual` | `2d`, `3d` | `2d` |
| `daylight` | `auto`, `day`, `night` | `auto` |
| `showNames`, `sounds`, `browserNotifications`, `dnd`, `showGit`, `evolution`, `employeeProject` | `true` or `false` | names on, sounds on, Git status on, evolution on, the rest off |
| `bubbles` | `all`, `important`, `none` | `important` |
| `animation` | `calm`, `normal`, `lively` | `normal` |
| `volume` | 0 to 1 | `0.5` |
| `usageLimits` | Object keyed by account id: `{ "unit": "usd" \| "tokens", "window5h"?: number, "week"?: number }` | none |

**Office evolution.** `evolution` (default on) is what **Settings → Office evolution** edits: the decoration unlocked by the level, the level counter and the achievement toasts; off shows the plain office. `employeeProject` (default off) adds the project name to the Employee of the month in the achievements dialog. Both only change what the page shows; the server keeps counting.

**Git status.** `showGit` is what **Settings → Show Git status** edits. It only hides the branch, changes and pull request in the page: the server keeps reading each repository (read-only, a few short `git` commands every 30 seconds to 5 minutes, at most two at a time). The other Git setting, the `gh` pull request lookup, is a server setting kept in `git-settings.json` in the [state directory](#state-directory), not in the browser.

**Usage limits.** `usageLimits` is what **Consumo → Limits (optional)** edits: the limit of your Claude plan per 5 h window and per week for each account, in US$ of estimated cost (`usd`) or in tokens (`tokens`, typed in millions). The usage forecast uses it as its reference; without it the reference is your highest recent 5 h block or week. Claude's real limits cannot be read from this computer, so type what your plan allows (or a number you want to stay under). Only positive numbers survive validation, at most 32 accounts are kept, and nothing is sent to the server.

**Language.** The `language` preference is what **Settings → Language** edits. With `auto` (**Automatic (system)**) the page reads the list of languages your browser reports (`navigator.languages`, in order of preference) and takes the first one it supports, looking only at the language part of the tag: `pt`, `pt-BR` or `pt-PT` gives **Português (Brasil)**, `es` or `es-MX` gives **Español**, and `en` or anything unsupported gives **English**. A fixed choice (`pt-BR`, `en` or `es`) ignores the browser. The page also sets `<html lang>` to the language in use. Changing it applies at once, without a reload, and the same language is what the page sends along with the permission answers and messages it posts so the plugin hooks can phrase their output ([plugin](03-plugin.md#messages-to-agents)). To start over, clear the site's data in your browser or delete the `ai-office:prefs` key.

## Multiple accounts

An account is a Claude config directory. The server finds them like this:

1. If `AI_OFFICE_CLAUDE_DIRS` (or `--claude-dirs`) is set, exactly those directories are used and nothing else is searched. Include `~/.claude` in the list if you want it.
2. Otherwise it scans your home folder for `~/.claude` and every `~/.claude-<name>` directory that contains a `projects/` folder, and adds `CLAUDE_CONFIG_DIR` if that is set and exists.

Accounts are re-discovered about every 10 seconds, so a new one shows up without a restart. In the office, `~/.claude` is labeled **Personal** (**Pessoal** in Portuguese); any other directory is labeled with the text after `claude-` (for `~/.claude-work`, "work"). The default account comes first, and each account gets a stable color.

The plugin installer uses the same rules (including `AI_OFFICE_CLAUDE_DIRS`) and also honors `--account <dir>` (repeatable, replaces detection). Name extra accounts `~/.claude-<name>`, or list them explicitly in `AI_OFFICE_CLAUDE_DIRS`.

To see what the server found, open the usage cards in the top bar (one per account) or call the authenticated health endpoint described in [troubleshooting](08-troubleshooting.md#how-to-collect-diagnostics). [Prompt 04](prompts/04-multiple-accounts.md) walks through the setup.

## Codex sessions

AI Office follows the sessions of the [OpenAI Codex CLI](https://github.com/openai/codex) read-only. The server looks in `CODEX_HOME` (default `~/.codex`) and in every folder of `AI_OFFICE_CODEX_DIRS`; each existing folder is an account (the first is labeled **Codex**, the others `Codex <folder name>`). Inside a Codex home it reads only `sessions/YYYY/MM/DD/rollout-*.jsonl` and `session_index.jsonl`.

- **Open sessions.** Codex keeps no registry of running processes, so a session counts as open while its rollout file was written in the last 30 minutes; it is working from the start to the end of a turn, waiting while an approval or question is unanswered, idle after. A session that was quiet for 30 minutes leaves the office and comes back when it is written again. New files are found in the day folders of the last window and the day before, so a very old session resumed today may not appear until Codex starts a new file.
- **Turning it off.** **Settings → Show Codex sessions** (stored in `<state dir>/codex-settings.json`) or `AI_OFFICE_CODEX=0`.
- **Costs** use OpenAI's public list prices for the Codex models (see [evidence and limits](06-validation.md#known-limits)); a model without a known price shows tokens and no cost.

```sh
# A second Codex home, and no Codex at all
AI_OFFICE_CODEX_DIRS=~/.codex-work npm start
AI_OFFICE_CODEX=0 npm start
```

## Team mode

Team mode connects computers of one local network. It is configured in **Settings → Team mode**, not with variables, and it is off until you use it. The mode never changes the main listener: `AI_OFFICE_HOST` and the loopback rules apply as before.

- **Host a team.** Pick your name, the team's name, the network address (one of this computer's private IPv4 addresses; a shared 100.64.x.x address needs you to confirm a warning) and a port (default `4849`). The optional device name is what the others see for this computer. A separate listener opens on that address and port; the page shows the address and a pairing code. Open the port in your firewall only for your LAN if it asks. The listener comes back by itself when AI Office restarts, until you press **Stop listening** or **End the team**.
- **Join a team.** Type the host's address (`192.168.0.12` or `192.168.0.12:4849`) and the code. The connection is kept and reconnects by itself (1 s, doubling up to 30 s) until the host removes you or ends the team.
- **What you share** and **Pause sharing** live in the same dialog; see [privacy and security](05-privacy-and-security.md#team-mode).
- **Files.** `<state dir>/team/` (below). **Environment.** `AI_OFFICE_TEAM=0` removes the mode; `AI_OFFICE_TEAM_DEVICE` sets the device name; `AI_OFFICE_TEAM_LOOPBACK=1` is for tests.
- A computer is either a host or a member of one team, not both.

## State directory

The server keeps its own files in the state directory, `~/.ai-office` by default, created with mode 0700. It never writes inside Claude Code's directories.

| Path | Content |
| --- | --- |
| `token` | The access token: 32 random bytes as 64 hex characters, mode 0600. Created on first start and reused afterwards. See [privacy and security](05-privacy-and-security.md#access-token). |
| `names.json` | The name given to each agent, keyed by account, session and subagent, so a person keeps the same name across restarts. At most 3000 entries are kept. |
| `usage-index/` | The usage history behind **Consumo** and the usage cards, mode 0700: `meta.json` (what was read of each transcript) and one `YYYY-MM.json` shard per UTC month with hourly token counts and estimated cost per account, project, model and session. It is a cache of your transcripts: delete the folder while the server is stopped (or let AI Office do it when it finds a damaged file) and it is rebuilt from the previous month onwards. Months older than 13 are dropped. See [privacy and security](05-privacy-and-security.md#what-ai-office-stores). |
| `progress.json` | Mode 0600: the office level, achievements and lifetime counters per day (see [privacy](05-privacy-and-security.md#the-office-that-grows)). Delete it and the history is counted again. |
| `team/` | Mode 0700, only after you use [team mode](#team-mode): `host.json`, `member.json` (identity keys, public keys of the others, addresses; files 0600) and `settings.json` (what you share). Deleted by **Leave the team** and **End the team**. |
| `git-settings.json` | `{ "version": 1, "pullRequests": false }`, mode 0600: whether the server may ask your `gh` CLI for the pull request of each room's branch (**Settings → Look up pull requests with gh**). Off by default; a missing or unreadable file means off. |
| `days/YYYY-MM-DD.json` | The **My day** record for that day: per agent, milliseconds in each status. Written every 5 seconds, flushed to disk every 30 seconds. Demo agents are not recorded. |

To rotate the token, stop the server, delete `token`, start it again and reload the page. Hooks read the file on every run and pick up the new token.

To reset everything, delete the directory while the server is stopped.

## Demo mode

Demo mode adds fictitious agents (by default four projects across two fictitious accounts, **Personal** and **Work**, with subagents, shells, permission requests you can answer and occasional errors) alongside any real sessions. Real sessions are never altered.

| Switch | How |
| --- | --- |
| Server | `AI_OFFICE_DEMO=1` or `--demo` starts with it on. |
| Page | **Settings**, **Demo mode**, or the button on the empty screen. Works only on a page opened on this computer. |
| Browser only | Add `?mock=1` to the page URL: `http://127.0.0.1:4848/?mock=1`. The same simulator runs inside the page with no server data and no network calls; the pill reads **Local demo**. |

Demo agents are not saved to **My day**. The demo's prompts, tasks and activities are shown in the interface language.

## Development mode

```sh
npm install
npm run dev
```

This starts two processes: the server with `tsx watch` on port 4848 (it restarts on code changes) and the Vite dev server on port 5173 for the web app. Open <http://localhost:5173>. Vite proxies `/api` to the server at `http://127.0.0.1:$AI_OFFICE_PORT`, rewriting the `Host` and `Origin` headers to the server's own and adding the `Authorization: Bearer` header from your token file (`AI_OFFICE_STATE_DIR` is honored). The token never reaches the browser in dev, and the page needs no cookie.

The server process started by `npm run dev` runs in the background of the script. If port 4848 is still in use after you stop Vite, stop the leftover server before starting another.

The `packages/web/dev/` folder has stand-alone harnesses served by the Vite dev server: `/dev/world2d.html`, `/dev/world3d.html` and `/dev/sprites.html`. The 3D one accepts query parameters for a synthetic office, for example `?projects=12&agents=40&hud=1&daylight=night`. They are how the frame rates in [evidence and limits](06-validation.md) can be reproduced.

## Next

- [Plugin](03-plugin.md): what the hook settings change.
- [Privacy and security](05-privacy-and-security.md)
- [Troubleshooting](08-troubleshooting.md)
- [Server spec](spec/02-server.md)
