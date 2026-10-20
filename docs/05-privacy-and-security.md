# Privacy and security

This guide states exactly what AI Office reads, what it stores, how it keeps everything on your computer, how access is protected and how to report a vulnerability.

The short version: the server reads Claude Code's files read-only, binds to `127.0.0.1`, makes no outbound network requests and refuses requests that do not carry its access token or that come from another site. The one thing it can start is a terminal window running Claude Code, only when you hire an agent (see [Hiring an agent](#hiring-an-agent)).

## What AI Office reads

The server reads files that Claude Code already writes in each account's config directory (for example `~/.claude`). It never writes to them.

| Source | Used for |
| --- | --- |
| `<dir>/sessions/<pid>.json` | Which sessions are open (a session is open while its file exists and its process is alive), its working directory, title and busy or idle state. |
| `<dir>/projects/<project>/<session>.jsonl` | The session transcript: prompts, replies, tool calls and results, token usage and model. Tailed incrementally. At startup only the last 2 MB of each transcript is read; after that, only new lines. |
| `<dir>/projects/<project>/<session>/subagents/agent-<id>.jsonl` and `.meta.json` | Subagent activity, type and description. |

Beyond live tailing, two features read more on request:

- **Terminal panel and session history** read a transcript on demand to show the conversation, and scan the last 7 days of transcripts for titles. Entries keep at most 4 KB of text each, a view pages at 500 entries, and the cached view is capped at about 8 MB.
- **Usage cards** are filled by a background scan of recent transcripts that looks only at token counts, model and timestamps.

It does not read your credentials, your Claude Code settings, your API keys or your project source files. Statistics only cover what it has read: the tail at startup plus everything new.

## What AI Office stores

Only its own state directory (`~/.ai-office` by default, mode 0700):

| File | Content |
| --- | --- |
| `token` | The random access token (mode 0600). |
| `names.json` | The name picked for each agent, keyed by account, session and agent id. |
| `days/YYYY-MM-DD.json` | Per agent, per day, time spent in each status (for **My day**). |

Messages, permission requests and notifications live in the server's memory and are gone when it stops. The browser stores your interface preferences, including the interface language, in `localStorage` (`ai-office:prefs`). The page also sends the language code in use (`pt-BR`, `en` or `es`) with the messages and permission answers it posts, so the plugin can phrase its output in that language; the code stays on this computer like everything else. No transcript content is written to disk by AI Office.

## Local only

- The server binds to `127.0.0.1` by default. A non-loopback `AI_OFFICE_HOST` is refused at startup unless remote access is explicitly allowed.
- The server and the plugin hooks make **no outbound network requests**. The hooks connect to `127.0.0.1` and nothing else.
- Features that act on sessions (terminal, session history, permissions, messages, attention marks, hiring an agent, the demo switch) are **local-only**: they require a loopback bind, a loopback `Host` header and a loopback peer address. Without all three they answer 403 `local-only`.
- The web app loads all its scripts, styles and assets from the server itself. 3D models and textures are bundled (CC0), not fetched from a CDN.

## Access token

On first start the server creates 32 random bytes, hex encoded, at `<state dir>/token` (file mode 0600, directory mode 0700) and reuses it afterwards. Every `/api/*` route except `GET /api/health` requires it:

| Client | How it presents the token |
| --- | --- |
| Plugin hooks | `Authorization: Bearer <token>`, read from the token file on every run. |
| The web page | An `ai_office_token` cookie: `HttpOnly`, `SameSite=Strict`, `Path=/`. The server sets it only when it serves the page to a loopback peer over a loopback bind. There is no `?token=` bootstrap. |

A missing or wrong token gets 401 `unauthorized`, including for unknown paths. The token is compared in constant time.

`GET /api/health` without a token returns only `{"ok":true}`. With a `challenge` nonce it also returns `proof`, an HMAC-SHA256 of `ai-office/health/v1:<nonce>` keyed with the token. A hook verifies this proof **before** sending the token anywhere, so a stranger squatting on the port never sees the token and can never get a permission auto-approved.

Never share the token or paste it into chats, issues or logs. If it may have leaked, rotate it: stop the server, delete `token`, start the server and reload the page.

## Request guards

Every request passes through a guard before any handler runs:

| Check | Rejects with |
| --- | --- |
| `Host` header must be a loopback name (or the bind address, or an IP literal for a wildcard bind) and carry the right port. Protects against DNS rebinding. | 403 `host-not-allowed` |
| `Sec-Fetch-Site`, when sent, must be `same-origin` or `none`. | 403 `cross-site` |
| Only `GET`, `HEAD` and `POST` are served. | 405 |
| `POST` must be `application/json`. | 415 |
| `POST` `Origin`, when present, must be the page's own origin (hooks send none). | 403 `origin-not-allowed` |
| Request bodies are limited to 256 KB. | 413 |

Limits: a request must arrive within 30 seconds and its headers within 15 seconds (this does not apply to long-lived responses), at most 20 simultaneous live streams (more get 503 `too-many-streams`), and long-poll waits are capped at 25 seconds per request.

Every response, static or API, carries:

```text
Content-Security-Policy: default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; worker-src 'self' blob:; connect-src 'self'; frame-ancestors 'none'
X-Frame-Options: DENY
X-Content-Type-Options: nosniff
Referrer-Policy: no-referrer
```

The page cannot be framed, cannot load scripts from other origins and cannot connect anywhere but its own server. The UI builds text with `textContent`, never `innerHTML` with session data.

## Hiring an agent

`POST /api/agents/hire` is the only endpoint that starts a program. What it can launch is fixed:

- **Which program.** A terminal window (`osascript` for Terminal.app or iTerm2 on macOS; `x-terminal-emulator`, `gnome-terminal`, `konsole`, `xfce4-terminal` or `xterm` on Linux) that runs `/bin/sh` on a launcher script the server wrote, which runs the `claude` executable the server found itself (an absolute `PATH` entry, `~/.local/bin/claude` or `~/.claude/local/claude`). The request cannot name an executable, arguments or environment variables: it carries only a folder, an account id, a prompt, a model alias, a permission mode, a desk number and a language, each validated (absolute existing readable folder, a known account, enums, size limits: prompt 8000 characters, path 1024). Unknown fields are ignored. Permission modes that skip checks (`bypassPermissions`, `dontAsk`) cannot be chosen from the office.
- **No shell injection.** The folder, the prompt and the account directory only appear in the launcher script, written with single-quote quoting (tested against quotes, spaces, newlines, `$()`, backticks, unicode and leading dashes by running the script with a stub `claude`); the terminal is only ever told to run `/bin/sh '<script path>'` and the programs are started with argument arrays, never through a shell. The prompt is one argument.
- **Where the prompt goes.** The launcher lives in a fresh private directory (mode 0700, file 0600) under the system temp dir and deletes itself and its directory the moment it starts (a launcher nobody ran is removed after 10 minutes). The prompt then lives in the Claude Code session like any other prompt.
- **Guards.** Local-only (loopback bind, `Host` and peer), the access token, `Sec-Fetch-Site`, JSON-only and same-origin `POST`, a 256 KB body limit and **5 launches per minute**; the folder check endpoint has its own limit (120 per minute) and only tells whether a directory exists and can be entered.
- **Demo mode.** Nothing is launched: hires into non-real rooms are simulated.

If you do not want this at all, do not open the page on the computer that runs AI Office: the endpoint answers 403 `local-only` to every other client. A macOS prompt asks once whether the app that runs the server may control Terminal.

## Remote access

Remote access is **not supported for browsers**. The setting exists only for programmatic `Bearer` clients:

- `AI_OFFICE_HOST` set to a non-loopback address (for example `0.0.0.0`) is refused at startup unless `AI_OFFICE_ALLOW_REMOTE=1` (or `--allow-remote`) is also set.
- Even with it, the server issues no cookie to non-loopback peers, offers no token in the URL, and keeps all local-only features off. A remote browser sees a page that cannot authenticate.
- With a wildcard bind, only IP-literal `Host` values are accepted, never arbitrary names.

Exposing the server to a network is your responsibility. If you want to see the office from another device, there is no supported way today.

## Cost figures are estimates

Costs shown in the usage cards and the **Custo** tile are computed locally from public list prices per model family and token counts. They ignore plan discounts, subscriptions and anything your account is actually billed. Token counts exclude cache reads. Treat them as a rough guide, not an invoice.

## Reporting a vulnerability

Do not open a public issue. Follow [SECURITY.md](../SECURITY.md): report privately through GitHub Security Advisories, with the affected component, steps to reproduce and your environment, and redact tokens, personal paths and session content from any logs.

## Next

- [Plugin](03-plugin.md): how the hooks authenticate.
- [Configuration](04-configuration.md): host, port and state directory settings.
- [Architecture](07-architecture.md)
- [Architecture spec, Security section](spec/01-architecture.md)
