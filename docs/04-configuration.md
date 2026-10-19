# Configuration

This guide lists every setting of the server and the plugin hooks, explains how accounts are discovered, what lives in the state directory, and how demo and development modes work.

AI Office needs no configuration file. Settings come from environment variables or command-line flags; a flag wins over its environment variable. Interface preferences (2D or 3D, day and night, sounds) are not server settings: they live in your browser. See [using the office](02-using-the-office.md#configurações).

## Server settings

Set an environment variable in front of the command, or run the bundle directly with flags:

```sh
AI_OFFICE_PORT=4900 npm start
node packages/server/dist/index.js --port 4900 --debug
```

Flags do not pass through `npm start --`; use environment variables with `npm start`, or run `node packages/server/dist/index.js` yourself.

| Environment variable | Flag | Default | Meaning |
| --- | --- | --- | --- |
| `AI_OFFICE_PORT` | `--port <n>` | `4848` | TCP port (1 to 65535). An invalid value stops the server with "Porta inválida". |
| `AI_OFFICE_HOST` | `--host <addr>` | `127.0.0.1` | Address to bind. Anything that is not a loopback address is refused unless remote access is allowed (below). |
| `AI_OFFICE_ALLOW_REMOTE` | `--allow-remote` | off | Accept a non-loopback `AI_OFFICE_HOST`. Even then, browsers cannot sign in remotely. See [privacy and security](05-privacy-and-security.md#remote-access). |
| `AI_OFFICE_CLAUDE_DIRS` | `--claude-dirs <list>` | auto-discovery | Comma-separated Claude config directories to watch. Replaces auto-discovery entirely. `~` is expanded. |
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

## Multiple accounts

An account is a Claude config directory. The server finds them like this:

1. If `AI_OFFICE_CLAUDE_DIRS` (or `--claude-dirs`) is set, exactly those directories are used and nothing else is searched. Include `~/.claude` in the list if you want it.
2. Otherwise it scans your home folder for `~/.claude` and every `~/.claude-<name>` directory that contains a `projects/` folder, and adds `CLAUDE_CONFIG_DIR` if that is set and exists.

Accounts are re-discovered about every 10 seconds, so a new one shows up without a restart. In the office, `~/.claude` is labeled **Pessoal** (personal); any other directory is labeled with the text after `claude-` (for `~/.claude-work`, "work"). The default account comes first, and each account gets a stable color.

The plugin installer uses the same rules (including `AI_OFFICE_CLAUDE_DIRS`) and also honors `--account <dir>` (repeatable, replaces detection). Name extra accounts `~/.claude-<name>`, or list them explicitly in `AI_OFFICE_CLAUDE_DIRS`.

To see what the server found, open the usage cards in the top bar (one per account) or call the authenticated health endpoint described in [troubleshooting](08-troubleshooting.md#how-to-collect-diagnostics). [Prompt 04](prompts/04-multiple-accounts.md) walks through the setup.

## State directory

The server keeps its own files in the state directory, `~/.ai-office` by default, created with mode 0700. It never writes inside Claude Code's directories.

| Path | Content |
| --- | --- |
| `token` | The access token: 32 random bytes as 64 hex characters, mode 0600. Created on first start and reused afterwards. See [privacy and security](05-privacy-and-security.md#access-token). |
| `names.json` | The name given to each agent, keyed by account, session and subagent, so a person keeps the same name across restarts. At most 3000 entries are kept. |
| `days/YYYY-MM-DD.json` | The **Meu dia** record for that day: per agent, milliseconds in each status. Written every 5 seconds, flushed to disk every 30 seconds. Demo agents are not recorded. |

To rotate the token, stop the server, delete `token`, start it again and reload the page. Hooks read the file on every run and pick up the new token.

To reset everything, delete the directory while the server is stopped.

## Demo mode

Demo mode adds fictitious agents (by default four projects across two fictitious accounts, **Pessoal** and **Trabalho**, with subagents, shells, permission requests you can answer and occasional errors) alongside any real sessions. Real sessions are never altered.

| Switch | How |
| --- | --- |
| Server | `AI_OFFICE_DEMO=1` or `--demo` starts with it on. |
| Page | **Configurações**, **Modo demonstração**, or the button on the empty screen. Works only on a page opened on this computer. |
| Browser only | Add `?mock=1` to the page URL: `http://127.0.0.1:4848/?mock=1`. The same simulator runs inside the page with no server data and no network calls; the pill reads **Demonstração local**. |

Demo agents are not saved to **Meu dia**.

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
