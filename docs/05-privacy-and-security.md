# Privacy and security

This guide states exactly what AI Office reads, what it stores, how it keeps everything on your computer, how access is protected and how to report a vulnerability.

The short version: the server reads Claude Code's files read-only, binds to `127.0.0.1`, makes no outbound network requests and refuses requests that do not carry its access token or that come from another site.

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
| `days/YYYY-MM-DD.json` | Per agent, per day, time spent in each status (for **Meu dia**). |

Messages, permission requests and notifications live in the server's memory and are gone when it stops. The browser stores your interface preferences in `localStorage` (`ai-office:prefs`). No transcript content is written to disk by AI Office.

## Local only

- The server binds to `127.0.0.1` by default. A non-loopback `AI_OFFICE_HOST` is refused at startup unless remote access is explicitly allowed.
- The server and the plugin hooks make **no outbound network requests**. The hooks connect to `127.0.0.1` and nothing else.
- Features that act on sessions (terminal, session history, permissions, messages, attention marks, the demo switch) are **local-only**: they require a loopback bind, a loopback `Host` header and a loopback peer address. Without all three they answer 403 `local-only`.
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
