# Architecture

npm workspaces monorepo, TypeScript strict everywhere, ESM, Node 22+, Vitest.

```
packages/
  shared/   @ai-office/shared  types + protocol (the contract) + pure helpers (names, colors, demo simulator)
  server/   @ai-office/server  Node HTTP server: discovery, transcript tailing, office model, SSE, REST, static web
  web/      @ai-office/web     Vite app: UI (vanilla TS + DOM, no framework), 2D world (Canvas2D), 3D world (three.js)
  plugins/  @ai-office/plugins Claude Code plugin + marketplace manifest + installer CLI
docs/spec/  this specification
```

## Data flow
Claude Code files, server watchers/parsers, `Office` model (agents, projects, activities), change events, snapshot
builder (throttled), SSE `/api/stream`, web `Store`, UI components + `World` (2D or 3D).
Hooks (plugin) call REST (`/api/permissions`, `/api/messages`), registries update the Office, SSE carries it to the
page, page decisions go back to the hooks.

## Conventions
- Small focused modules (200-400 lines typical, 800 max), pure functions where possible, explicit error handling.
- No `any`. Validate all external input (HTTP bodies, JSONL lines, hook stdin) defensively.
- Server never throws on bad data: skip the line, log once at debug level.
- Tests next to code (`*.test.ts`), Arrange-Act-Assert, descriptive names. Synthetic fixtures only (never commit real
  transcripts).
- Web: no UI framework; small component classes with `el` + `render()`; render batched per animation frame; DOM built
  with a tiny `h()` helper; text via textContent (never innerHTML with user data).
- Visible text in pt-BR. Code identifiers/comments in English.

## Security
- Bind 127.0.0.1 (AI_OFFICE_HOST to change; then local-only features turn off).
- Request guard: allowed Host values (localhost, 127.0.0.1, [::1] with the port); POST requires
  `Content-Type: application/json` and an Origin that is the page itself (or no Origin, for hooks); body limit 256 KB.
- Local-only features (terminal, sessions history, permissions, messages) require both loopback bind and loopback Host.
- No secrets; no outbound network requests.

## Build and run
- `npm run dev`: server (tsx watch, port 4848) + Vite dev server (proxy /api to 4848).
- `npm run build`: web into packages/web/dist; server bundle into packages/server/dist; `npm start` serves web + API.
