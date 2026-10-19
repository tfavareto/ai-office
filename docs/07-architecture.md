# Architecture

This guide describes the four packages, how data flows from Claude Code's files to the office on screen and from your answers back to the agents, and the design choices behind it. Each part links to its detailed spec.

## Packages

AI Office is an npm workspaces monorepo written in strict TypeScript (ES modules, Node.js 22+, Vitest).

| Package | Name | Responsibility |
| --- | --- | --- |
| `packages/shared` | `@ai-office/shared` | The contract between everything else: model types (`Agent`, `Project`, `OfficeSnapshot`, ...), the HTTP and stream protocol, and pure helpers (agent names, colors, activity text, formatting, hashing). Also the **demo simulator**, which powers demo mode on the server and `?mock=1` in the browser. |
| `packages/server` | `@ai-office/server` | A Node `node:http` server with no framework. Discovers accounts, tails Claude Code transcripts, builds the office model, publishes snapshots over Server-Sent Events, serves the REST endpoints and the built web app, and holds the registries the plugin talks to. Bundled with esbuild (shared included) into `dist/index.js`. |
| `packages/web` | `@ai-office/web` | A Vite app in vanilla TypeScript: the UI panels, the client store, the 2D world (Canvas 2D, pixel art drawn in code) and the 3D world (three.js, loaded lazily). |
| `packages/plugins` | `@ai-office/plugins` | The Claude Code plugin `ai-office` (hook scripts and manifests) and the installer script. |

Dependencies point one way: `server` and `web` depend on `shared`; `plugins` depends on no other package (hooks cannot import `shared` at runtime, so they repeat the default port, the token file name and the health-proof prefix).

## Data flow

```text
Claude Code files            AI Office server (127.0.0.1)                          Browser
-----------------            -----------------------------                         -------
sessions/<pid>.json  -.
projects/**/*.jsonl  --+--> Engine --> Office model --> SnapshotPublisher --SSE--> Store --> UI panels
subagents/agent-*    -'    (tail,      (agents, rooms,   (at most 4/s)       |             `-> World (2D or 3D)
                            parse)      feed, notices)                       |
                                            ^                                |
Plugin hooks ----REST----> Registries ------'                                |
  PermissionRequest        permissions                                       |
  PostToolUse / Stop       messages    <------ POST decision / message ------'
  Notification             attention
       ^                       |
       '---- long-poll <-------'
```

### From files to the screen

1. The **Engine** discovers accounts (see [configuration](04-configuration.md#multiple-accounts)), polls each account's session registry every second, and tails each open session's transcript incrementally with byte offsets (handling partial lines, truncation and rotation; `fs.watch` with a polling fallback).
2. Each line is parsed defensively and reduced into a per-transcript state: the current turn, pending tool calls, shell jobs, tasks, token usage and costs. A bad line is skipped and logged once at debug level.
3. The **Office** model turns those states into agents (one main agent per open session, one sub agent per subagent), projects (rooms) and a feed, derives each status with a pure function, and emits notices (an agent needs you, a turn completed, a tool error).
4. The **SnapshotPublisher** builds a full `OfficeSnapshot` and emits it at most four times a second. The **SSE hub** sends the snapshot and the last 100 feed items when a page connects, then pushes changes, with a 15-second heartbeat.
5. In the browser the **Store** receives the stream (reconnecting with a delay that grows from 2 to 30 seconds) and notifies the UI. The UI renders panels by batching DOM updates once per animation frame and hands each snapshot to the **World**, which updates a simulation of people walking to desks, the café and the elevators.

### From the plugin to the agent and back

- **Permissions.** The `PermissionRequest` hook posts to the permission registry, which attaches the request to the agent. The next snapshot carries it, the page shows the card, and your decision is posted back. The hook, long-polling the registry, receives the decision and prints it as the hook output. If the session moves on in the meantime, the registry cancels the request.
- **Messages.** The page posts to the message registry, which queues per agent. The `PostToolUse`, `Stop` and `SubagentStop` hooks call the inbox endpoint, which consumes the queue and marks messages delivered; the `Stop` hook may long-poll instead (stand-by).
- **Attention.** The `Notification` hook posts a mark that overlays the agent's status until its next transcript event.

Details of the hooks are in [plugin](03-plugin.md).

## Server layout

| Folder | Role |
| --- | --- |
| `src/claude/` | Reading Claude Code files: accounts, session registry with process liveness, the incremental JSONL tailer, the line parser, the transcript reducer, tasks, stats and cost, subagent discovery, the transcript renderer, the recent-sessions scan, usage backfill and the ingest `Engine`. |
| `src/office/` | The model: `Office`, pure status derivation, subagent lifecycle rules, names, the snapshot publisher, per-account usage and the day recorder. |
| `src/registries/` | Permissions (pending map, expiry, long-poll), messages (queues, 2-hour TTL, inbox, long-poll, groups) and attention. |
| `src/http/` | Request guard, router, SSE hub, static files, token auth and one handler module per route group. |
| `src/app.ts` | Composition root (`createApp`). `src/index.ts` is the command-line entry. |

## Web layout

| Folder | Role |
| --- | --- |
| `src/net/` | The `Store`, the SSE transport with reconnection, the HTTP backend, and the mock environment for `?mock=1`. |
| `src/ui/` | Components (top bar, sidebar, drawer, feed, toasts, notification center, terminal panel, dialogs), their view models, shortcuts and the world host. |
| `src/prefs/` | Preferences validated field by field and stored in `localStorage`. |
| `src/world/` | `WorldApi`, the contract the UI uses for any renderer, and the loader. |
| `src/layout/`, `src/sim/` | The floor plan and the deterministic simulation (pathfinding, spots, behavior by status, speech bubbles), shared by 2D and 3D. |
| `src/world2d/` | The Canvas 2D renderer. All art is drawn procedurally into cached offscreen layers; per frame it draws layers, y-sorted characters and an overlay. |
| `src/world3d/` | The three.js renderer: scene, CC0 glTF furniture and people, city frame, cameras, day and night lighting. Loaded with a dynamic import only when you pick 3D. |

## Design choices

- **Read-only toward Claude Code, local by construction.** The only inputs are files Claude Code already writes. The server binds to loopback, makes no outbound requests and guards every request ([privacy and security](05-privacy-and-security.md)).
- **Hooks must never hurt a session.** They are tiny plain-Node scripts with hard timeouts that exit 0 with no output on any problem, and they verify the server's identity before sending a token.
- **No framework.** `node:http` on the server and plain DOM helpers on the client keep dependencies, bundle size and startup time small. DOM text always goes through `textContent`.
- **Full snapshots, throttled.** The server sends the whole state at most four times a second instead of diffs. It is simple, self-healing after a reconnect and cheap at this size.
- **Long-polling for hooks.** A hook is a short-lived process; a 25-second long-poll loop is simpler and more robust than a persistent socket, and lets the server count pages to decide whether to wait at all.
- **One simulation, two renderers.** The people's movement and behavior live in a pure, seeded simulation, so 2D and 3D show the same office and the logic is testable without a canvas.
- **2D first.** The default view is cheap and was tuned to stay smooth; 3D is an optional visual and is loaded on demand.
- **Immutable, small modules.** Pure functions where possible (status derivation, view models, planning in the installer), small focused files, and synthetic test fixtures only.

## Specifications

| Spec | Subject |
| --- | --- |
| [00 · Product](spec/00-product.md) | Principles, features, shortcuts, non-goals |
| [01 · Architecture](spec/01-architecture.md) | Monorepo, data flow, conventions, security |
| [02 · Server](spec/02-server.md) | Configuration, data sources, agents, statuses, activities, REST, day recorder |
| [03 · 2D world](spec/03-world-2d.md) | Art direction, floor plan, simulation, characters, performance |
| [04 · UI](spec/04-ui.md) | Design system, components, accessibility |
| [05 · Plugin](spec/05-plugins.md) | Hooks, authentication, installer |
| [06 · 3D world](spec/06-world-3d.md) | The three.js renderer, cameras, assets, performance rules |
| [07 · Process](spec/07-process.md) | Contribution process |

## Next

- [Plugin](03-plugin.md) and [configuration](04-configuration.md)
- [Evidence and limits](06-validation.md)
- [Contributing](../CONTRIBUTING.md), [AGENTS.md](../AGENTS.md) and [prompt 07](prompts/07-contribute.md)
