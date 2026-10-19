# AI Office

**A live virtual office for your Claude Code sessions.** Every project you open becomes a room, every session is a
person at a desk, and subagents are colleagues who walk in, work in the meeting room and leave when they're done.
Watch what each agent is doing in real time, answer permission requests, send them messages and review your day —
all locally, nothing leaves your computer.

> *Em português:* o AI Office transforma as sessões do Claude Code abertas no seu computador em um escritório
> corporativo ao vivo. A interface é em português do Brasil.

## Features

- **Office view** — premium corporate office in pixel art (default) or an optional 3D view: reception, café, meeting
  room, lounge, restrooms and one room per project, with day/night by local time.
- **Live agents** — status (working, needs you, idle, running a shell), current activity, tasks, subagents, tokens and
  estimated cost per session; usage per account (5-hour window, week, today).
- **Answer permissions from the office** — approve, approve and remember, deny (with a reason) or leave it to the
  terminal; the terminal dialog keeps working and the first answer wins.
- **Message your agents** — send an instruction to one agent or to a whole room; it reaches the session after its next
  tool call, or as a new instruction when it finishes its turn (with an optional 10-minute stand-by).
- **Read-only terminal** — follow any session's conversation as the terminal shows it, plus a 7-day session history.
- **Notifications** — toasts, a notification center with filters and *Não perturbe*, optional browser notifications.
- **My day** — time per status per agent today.
- **Demo mode** — realistic fake sessions (`?mock=1` runs fully in the browser).

## Requirements

- Node.js 22+ and npm
- Claude Code (CLI or desktop) on the same machine
- macOS or Linux

## Quick start

```bash
npm install
npm run build
npm start            # http://127.0.0.1:4848
```

Install the Claude Code plugin (answers permissions, delivers messages, flags "needs you") into every detected
account:

```bash
npm run plugin:install     # also: plugin:status, plugin:uninstall
```

Open sessions pick it up after `/reload-plugins` or a restart.

Development: `npm run dev` (server with reload on :4848 + Vite on :5173), `npm test`, `npm run typecheck`,
`npm run lint`.

## Configuration

| Variable | Default | Meaning |
|---|---|---|
| `AI_OFFICE_PORT` | `4848` | HTTP port (the plugin uses the same variable) |
| `AI_OFFICE_HOST` | `127.0.0.1` | Bind address; non-loopback requires `AI_OFFICE_ALLOW_REMOTE=1` |
| `AI_OFFICE_CLAUDE_DIRS` | every `~/.claude*` with sessions | Claude Code config dirs (one per account), comma-separated |
| `AI_OFFICE_STATE_DIR` | `~/.ai-office` | Names, day records and the local access token |
| `AI_OFFICE_DEMO` | off | Start with demo sessions on |
| `AI_OFFICE_STANDBY_MIN` | `10` | Minutes a finished session waits for your messages (0 disables) |

## Privacy and security

AI Office only reads Claude Code files on this computer and binds to `127.0.0.1`. The page and the plugin hooks
authenticate with a random local token (`~/.ai-office/token`, mode 0600); the server sends a strict Content Security
Policy and rejects cross-site requests. If AI Office is not running, the hooks exit immediately and Claude Code behaves
normally.

## Project layout

```
packages/shared   types and protocol shared by everything, demo simulator
packages/server   reads Claude Code data, builds the office, HTTP + SSE API, serves the web app
packages/web      UI, 2D world (Canvas2D), 3D world (three.js, loaded on demand)
packages/plugins  Claude Code plugin (hooks) and installer
docs/spec         product and technical specification
```

## License

[MIT](LICENSE) © 2026 Thiago Salazar Favareto. Third-party 3D assets are CC0 — see
[`packages/web/public/assets/3d/CREDITS.md`](packages/web/public/assets/3d/CREDITS.md).
