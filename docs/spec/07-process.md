# Contribution process

How changes are made in this repository, for human contributors and coding agents alike. The short version for agents
lives in [AGENTS.md](../../AGENTS.md); the workflow for people in [CONTRIBUTING.md](../../CONTRIBUTING.md).

## Quality bar

- Professional, idiomatic TypeScript with strict types and no `any`.
- Small, focused modules (200-400 lines typical, 800 max); pure functions where possible; immutable updates.
- Tests for logic: parsers, simulation, registries, hooks, stores, helpers. Vitest, Arrange-Act-Assert, descriptive
  names, synthetic fixtures only (never real transcripts).
- No dead code, no leftover TODOs, no console noise in production paths.
- Errors are handled explicitly and external input (HTTP bodies, JSONL lines, hook stdin) is validated defensively.
- The server never throws on bad data: skip the line, log once at debug level.
- Visible UI text lives in the catalogs, with every key present in pt-BR, en and es; code, comments, docs, prompts and commit messages are English.

## Checks

Run from the repository root before every pull request:

| Command              | What it proves                                                                  |
| -------------------- | ------------------------------------------------------------------------------- |
| `npm run typecheck`  | `tsc -b` builds the references; `packages/shared` first, the others consume it. |
| `npm run lint`       | ESLint across the monorepo, including `scripts/`.                               |
| `npm test`           | Vitest for every package.                                                       |
| `npm run build`      | Web bundle and server bundle build.                                             |
| `npm run docs:check` | Markdown links and anchors, repository URLs, JSON syntax, README alignment.     |

Per package, while iterating:

| Package   | Typecheck                          | Tests                              |
| --------- | ---------------------------------- | ---------------------------------- |
| `shared`  | `npx tsc -b packages/shared`       | `npx vitest run --project shared`  |
| `server`  | `npx tsc -b packages/server`       | `npx vitest run --project server`  |
| `web`     | `npx tsc -p packages/web --noEmit` | `npx vitest run --project web`     |
| `plugins` | covered by `npm run lint`          | `npx vitest run --project plugins` |

CI (`.github/workflows/ci.yml`) runs the same checks on Ubuntu and macOS with Node 22 and 24.

## Ownership of the shared contract

`packages/shared` defines the types and protocol that server and web agree on. Treat every change there as a change to
both consumers:

1. Update the types in `packages/shared`, the server producer, the web consumer and the plugin hooks if they are
   involved, in the same change.
2. Update the matching spec in `docs/spec/` and any guide or prompt in `docs/` that describes the behavior.
3. Add or update tests on both sides of the boundary.
4. A change that needs to land in `packages/shared` while other work is in flight is raised with the maintainer first,
   never patched around in a consumer.

## Specs and documentation

- `docs/spec/` is the behavioral contract. If code and spec disagree, decide which is right and fix the other in the
  same change.
- Guides in `docs/`, the prompts in `docs/prompts/` and the READMEs must stay consistent with the code. Update them
  together when a command, flag, path or behavior changes.
- English is canonical. Only `README.pt-BR.md` and `README.es.md` are localized; keep the same sections and anchors as
  `README.md`.
- Public paths and file names stay in English; relative links between repository files must resolve.
- Run `npm run docs:check` after touching any Markdown, JSON or asset path.

## Privacy and security

- Local-only by design: the server binds to `127.0.0.1`, reads Claude Code files on this machine and sends nothing out.
- Never commit real session content, transcripts, tokens, personal paths or e-mails. Screenshots and recordings come
  from demo mode (`AI_OFFICE_DEMO=1` or `--demo`).
- Never weaken a guard: access token, Host and Origin checks, `Sec-Fetch-Site`, CSP and security headers, loopback-only
  features, request limits. Changes near them need tests that prove the guard still holds.
- Hooks must never block Claude Code: they exit fast and silently when AI Office is not running.

## Performance and assets

- The default 2D view stays smooth (60 fps target on a laptop, no main-thread stalls over 100 ms after load).
- The 3D view does not trade visual quality for frame rate without the maintainer's decision; report measurements
  instead of lowering quality quietly.
- Third-party assets must be CC0 or original, and credited in `packages/web/public/assets/3d/CREDITS.md`.

## Commits and pull requests

- Conventional commits: `feat`, `fix`, `refactor`, `docs`, `test`, `chore`, `perf`, `ci`.
- Keep pull requests small and single-purpose, with tests and updated docs. UI changes include a demo-mode screenshot.
- Commit only when asked; push, publish or open a pull request only on explicit request.

## Review

Reviewers check, in this order:

1. Security and privacy: guards intact, no secrets or personal data, external input validated.
2. Correctness and tests: behavior matches the spec, tests cover the change, edge cases are handled.
3. Contract: shared types, server, web, plugin and specs agree.
4. Quality bar: readability, module size, immutability, naming, no dead code.
5. Docs: guides, prompts, links and README translations are updated and `npm run docs:check` passes.

Blocking issues (security, data loss, broken contract) are fixed before merge; everything else is a suggestion the
author can accept or discuss.
