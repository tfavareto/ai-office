# AGENTS.md

Instructions for any coding agent (Claude Code, Codex, others) and for human contributors working in this repository.

## What this is

AI Office is a local web app that turns the Claude Code sessions running on your computer into a live virtual office:
each open project is a room, each session is a person, subagents are colleagues who arrive and leave. A small Claude
Code plugin lets you answer permission requests and send messages from the page. Everything stays on `127.0.0.1`.
MIT licensed. Node.js 22+, npm workspaces, TypeScript strict, macOS and Linux.

## Map

| Path               | What lives there                                                                                            |
| ------------------ | ----------------------------------------------------------------------------------------------------------- |
| `packages/shared`  | The contract: types, protocol, pure helpers, demo simulator. Server and web both depend on it.              |
| `packages/server`  | Node `node:http` server (no framework): discovery, transcript tailing, office model, SSE, REST, static web. |
| `packages/web`     | Vite app, vanilla TypeScript UI, Canvas 2D world, lazy three.js 3D world, assets in `public/assets/`.       |
| `packages/plugins` | Claude Code plugin `ai-office` (hooks), marketplace manifest, installer script.                             |
| `docs/spec/`       | Design specs: the contract for behavior. `docs/` also holds guides, `docs/prompts/` and `docs/assets/`.     |
| `scripts/`         | Repository tooling, e.g. the docs validator.                                                                |
| `.github/`         | CI workflow, issue and pull request templates.                                                              |

Start with `docs/README.md` (index) and `docs/spec/01-architecture.md`. Each package has its own README where relevant.

## Commands

```sh
npm install                # install all workspaces
npm run dev                # server (tsx watch, port 4848) + Vite dev server
npm run build              # web into packages/web/dist, server bundle into packages/server/dist
npm start                  # serve the built web app and the API on http://127.0.0.1:4848
npm test                   # Vitest across all packages (npx vitest run --project <pkg> for one)
npm run typecheck          # tsc -b; builds packages/shared first, the others depend on its output
npm run lint               # ESLint
npm run docs:check         # validates Markdown links, anchors, JSON and README alignment
npm run docs:test          # unit tests for the validator itself
npm run plugin:install     # also plugin:uninstall and plugin:status; add -- --dry-run to preview
```

Before handing work back, run `npm run typecheck`, `npm run lint`, `npm test`, `npm run build` and `npm run docs:check`.

## Scope and sources of truth

- The specs in `docs/spec/` are the contract. If code and spec disagree, decide which is right and fix the other in the
  same change.
- `packages/shared` is the shared contract. A change there touches server and web together; update both sides, their
  tests and the spec in one change.
- Do not edit files outside the task's scope. Report what you found instead of fixing unrelated things.

## Rules

- TypeScript strict, no `any`. Small focused modules (200-400 lines typical, 800 max). Prefer immutable updates and
  pure functions. Handle errors explicitly; validate external input (HTTP bodies, JSONL lines, hook stdin).
- Every logic change comes with tests (Vitest, Arrange-Act-Assert, descriptive names, synthetic fixtures next to the
  code). No console noise in production paths.
- UI text lives in the catalogs (`packages/web/src/i18n/{ui,world}/` and `packages/shared/src/i18n/messages/`). Every
  new user-visible string gets a key in pt-BR, en and es; pt-BR is the source, and types and catalog tests enforce
  parity. Never hardcode visible text, and never concatenate translated fragments (use parameters and plural forms).
  Texts the server or the demo generate are emitted as a `Msg` (`{ key, params }`) next to a pt-BR fallback `text`.
  Text from the user's own sessions is shown as written. Code, comments, docs, prompts and commit messages are English.
  Only `README.pt-BR.md` and `README.es.md` are localized; keep them aligned with `README.md` (same sections, anchors
  and screenshots in `docs/assets/readme/<lang>/`).
- Keep public paths and file names in English. When a contract changes, update docs, links and prompts together, then
  run `npm run docs:check`.
- Local-only and private: never commit real session content, transcripts, tokens, personal paths or e-mails.
  Screenshots, in any language, come from demo mode only (`AI_OFFICE_DEMO=1` or `--demo`).
- Never weaken a security guard (token, Host/Origin/Sec-Fetch-Site checks, CSP, loopback-only features, size and time
  limits). Treat a change near them as security-sensitive and test it.
- Hooks must never block Claude Code: they exit fast and silently when AI Office is not running.
- 2D must stay smooth. Do not trade 3D visual quality for fps without the maintainer's decision.
- Assets must be CC0 or original, and credited in `packages/web/public/assets/3d/CREDITS.md`.
- Conventional commits: `feat|fix|refactor|docs|test|chore|perf|ci: description`.
- Commit only when asked. Push, publish or open a pull request only on explicit request.

## More

[CONTRIBUTING.md](CONTRIBUTING.md) for the contributor workflow, [SECURITY.md](SECURITY.md) for vulnerability reports,
[docs/spec/07-process.md](docs/spec/07-process.md) for the contribution process.
