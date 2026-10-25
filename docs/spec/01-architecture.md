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
Claude Code files and, read-only, Codex CLI rollouts (`~/.codex/sessions`, translated by `server/src/codex` into the same
events), server watchers/parsers, `Office` model (agents, projects, activities), change events, snapshot
builder (throttled), SSE `/api/stream`, web `Store`, UI components + `World` (2D or 3D).
Codex has no hooks: its agents (`source: 'codex'`) are shown and totaled but never answered or messaged.
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
- Visible text lives in catalogs (pt-BR source, en, es); texts the server generates are `Msg {key, params}` next to a pt-BR `text` fallback. Code identifiers/comments in English.

## Security
- Bind 127.0.0.1. A non-loopback `AI_OFFICE_HOST` is refused at startup unless `AI_OFFICE_ALLOW_REMOTE=1`
  (`--allow-remote`); even then browsers cannot sign in remotely (no cookie is issued to non-loopback peers; there is
  no `?token=` bootstrap) and local-only features stay off. Only `Authorization: Bearer` clients work remotely.
- Access token: on start the server creates (or reuses) 32 random bytes (hex) at `<stateDir>/token`, mode 0600, state
  dir 0700. Every `/api/*` route except `GET /api/health` requires it as `Authorization: Bearer <token>` (hooks) or the
  `ai_office_token` cookie (HttpOnly, SameSite=Strict, Path=/), which the server sets when it serves `index.html` (and
  SPA routes) to a loopback peer. Missing/wrong token: 401 `{ error: 'unauthorized' }`, also for unknown paths.
  Unauthenticated health is `{ ok: true }` only; with `?challenge=<nonce>` it adds `proof = HMAC-SHA256(token,
  "ai-office/health/v1:" + nonce)` so hooks can check the server's identity before sending the token anywhere.
  Dev: the Vite proxy (`packages/web/vite.config.ts`) rewrites Host/Origin to the API and adds the bearer header read from
  the token file, so the browser needs no cookie and `src/net` needs no change.
- Request guard: allowed Host values (loopback names, or the bind address; with a wildcard bind only IP literals, never
  arbitrary names, against DNS rebinding) with the port; `Sec-Fetch-Site`, when sent, must be `same-origin` or `none`;
  POST requires `Content-Type: application/json` and an Origin that is the page itself (or no Origin, for hooks); body
  limit 256 KB. Endpoints that consume state are POSTs (`POST /api/messages/inbox`).
- Local-only features (terminal, sessions history, usage detail, permissions, messages) require both loopback bind and loopback Host.
- Every response (static and API): `Content-Security-Policy: default-src 'self'; img-src 'self' data: blob:; style-src
  'self' 'unsafe-inline'; worker-src 'self' blob:; connect-src 'self'; frame-ancestors 'none'`, `X-Frame-Options: DENY`,
  `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`. Note `connect-src 'self'` blocks `fetch`/XHR of
  `blob:` and `data:` URLs: load assets from same-origin files and build textures on canvases (`CanvasTexture`; `<img>`
  with data:/blob: is fine).
- Limits: request 30 s and headers 15 s (they bound receiving a request, not SSE or long-poll responses); at most 20
  SSE streams (503 `too-many-streams` beyond); transcript entries keep at most 4 KB of text, a cached view at most
  ~8 MB, and `/api/transcript` pages carry at most 500 entries.
- No secrets in the repo; no outbound network requests (the only exception: the optional, off-by-default pull request lookup through the user's own `gh` CLI, see 02-server).

## Build and run
- `npm run dev`: server (tsx watch, port 4848) + Vite dev server (proxy /api to 4848).
- `npm run build`: web into packages/web/dist; server bundle into packages/server/dist; `npm start` serves web + API.
