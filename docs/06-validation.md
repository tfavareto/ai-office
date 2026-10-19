# Evidence and limits

This guide records what is checked automatically, how to run the checks, the frame-rate measurements with their exact method and conditions, and what AI Office does not do or cannot promise.

## What is checked

| Check | Command | What it covers |
| --- | --- | --- |
| Typecheck | `npm run typecheck` | `tsc -b` across all four packages, TypeScript strict mode. |
| Lint | `npm run lint` | ESLint over the whole repository. |
| Unit and integration tests | `npm test` | Vitest, one project per package (see below). |
| Build | `npm run build` | Web app with Vite (typechecked first), then the server bundle with esbuild. |
| Docs validator tests | `npm run docs:test` | Unit tests for the validator script itself. |
| Docs check | `npm run docs:check` | `node scripts/validate-docs.mjs`: every local Markdown link and `#anchor` resolves, links to this repository's public URLs point at files that exist, JSON files parse, and the three READMEs stay aligned (same sections and anchors, and each translation's screenshots exist). |

Run everything before sending a change:

```sh
npm run typecheck && npm run lint && npm test && npm run build && npm run docs:test && npm run docs:check
```

### Tests

At the time of writing (2026-10-19) the suite has **1225 tests in 75 files**:

| Package | Tests | Files | What is exercised |
| --- | --- | --- | --- |
| `shared` | 568 | 20 | Activity text, names, colors, formatting, hashing and the demo simulator; the localization core (message format, plural rules, translator fallbacks) and the **server and demo message catalogs**, whose tests check that pt-BR, English and Spanish define exactly the same keys and placeholders. |
| `server` | 193 | 19 | Transcript parsing and tailing, status derivation, subagent lifecycle, stats and cost, registries (permissions, messages, attention), the request guard, `locale` validation, token auth, configuration, and an **end-to-end HTTP suite that boots the real server** on a free port. |
| `web` | 347 | 29 | The store and reconnection, the stream parser, preferences (including the language), UI models (counters, notifications, delivery, terminal, day) in all three languages, locale-aware formatting, the **UI and world catalogs** (same keys in every language, no unused or missing keys), the 2D layout and simulation, cameras and picking in both worlds, and pure parts of the 3D scene. |
| `plugins` | 117 | 7 | Each hook **run as a real child process** against a small in-process fake server (allow, deny, terminal, offline exit speed, message delivery, stand-by wake-up, subagent guard, the language of denials and message preambles), the token and challenge logic, the installer's planning with a fake `claude` CLI, and the plugin and marketplace manifests. |

All fixtures are synthetic: temporary directories and invented transcripts, never real sessions.

Run one package with `npx vitest run --project server` (or `shared`, `web`, `plugins`).

### Continuous integration

`.github/workflows/ci.yml` runs on every push to `main`, every pull request and on demand. It uses a matrix of **Ubuntu and macOS** with **Node 22 and 24**, and for each runs: `npm ci`, typecheck, lint, test, build, the validator tests and `npm run docs:check`. The workflow has read-only repository permissions.

## Frame-rate measurements

Frames per second were measured to find the rendering headroom of each view, not to claim a number you will see on your screen. Your display shows at most its refresh rate (usually 60 fps), so any figure above that means "comfortably smooth".

### Conditions

| Item | Value |
| --- | --- |
| Date | 2026-10-19 |
| Machine | MacBook with an Apple A18 Pro chip |
| System | macOS 27, Node 26 |
| Browser | Chromium |
| Viewport | 1440 by 900 at 2x pixel ratio |
| Data | The maintainer's real Claude Code sessions: 4 agents in 4 rooms |
| Vsync | Off, so the renderer's own capability is measured instead of being capped by the display |
| Power | On battery, with Low Power Mode, which caps the display at 30 fps when vsync is on |

### Results

| View | Day | Night |
| --- | --- | --- |
| 2D | 427 fps | 385 fps |
| 3D, full quality | 83 fps | 21 fps |
| 3D, full quality but without MSAA at night | not measured | about 46 fps |

The 3D night scene is the expensive one. Its bloom pass combined with multisample anti-aliasing (MSAA) at a 2x pixel ratio accounts for most of the cost; leaving MSAA out roughly doubled the night rate in the test above. The 3D renderer ships at full quality, and quality is not reduced to chase frame rate.

A separate stress test used the 3D lab page with a synthetic office of **12 rooms and 40 agents**, on an earlier build that still had quality reductions: **49 to 60 fps by day and 21 to 39 fps at night**. That build is not the shipping renderer, so treat these as a rough indication of how load scales, not as current figures.

### How to measure on your machine

1. Run the server and open the office. In the browser console, `window.aiOffice.debug()` returns the renderer's own counters under `world`, including `fps`, the CPU draw time (`drawMs`) and the number of agents.
2. For a controlled scene, use the dev harness (see [configuration](04-configuration.md#development-mode)): with `npm run dev`, open `http://localhost:5173/dev/world3d.html?projects=12&agents=40&hud=1&daylight=night`. The `hud=1` parameter prints fps, CPU time, agents, draw calls and pixel ratio on screen. `/dev/world2d.html` is the 2D equivalent.
3. To see headroom beyond your display rate, launch Chromium with `--disable-gpu-vsync --disable-frame-rate-limit` and count `requestAnimationFrame` callbacks over a few seconds after the scene has loaded (the figures above are a 6-second count, taken 4 s after load for 2D and 8 s for 3D). With vsync on, the measured rate is capped at your refresh rate, and Low Power Mode on a laptop halves it to 30 fps.

If 3D feels slow, switch to 2D in **Settings**, set **Day and night** to **Day** (the day scene is far cheaper), turn off Low Power Mode, or plug in.

## Known limits

**Accuracy**

- **Costs are estimates.** They come from public list prices per model family and token counts, and ignore subscriptions, discounts and what you are really billed. Token counts exclude cache reads.
- **Statistics cover what was read.** At startup only the last 2 MB of each transcript is read, so totals for a long-running session start from there and grow as new lines arrive.
- **Statuses are inferred.** They come from Claude Code's session registry and transcripts. Where the registry is missing for an account, the server falls back to recent transcripts and is less precise about busy versus idle.
- **Claude Code's file layout is not a stable public interface.** AI Office follows the layout used by the Claude Code versions it was developed against. A Claude Code update that changes it can break discovery or status until AI Office is updated.

**Platform**

- **macOS and Linux only.** Windows is a non-goal. CI covers Ubuntu and macOS; the performance measurements above come from a single Mac and a single browser (Chromium), and were not repeated on Linux.
- **Interface language:** English, Portuguese (Brazil) and Spanish. Text that comes from your own sessions is shown as written, and the plugin's status lines in Claude Code and the server's command-line messages are fixed Portuguese strings.
- **Single user, single machine.** Browsers cannot sign in from another computer. At most 20 pages can stay connected at once.

**Rendering**

- **3D is heavier than 2D**, most of all at night (see the table). On a laptop in Low Power Mode, display refresh is capped at 30 fps.
- 3D needs WebGL 2 and downloads its models and textures the first time you switch to it.

**Plugin**

- Messages reach an agent only when one of its hooks runs: after a tool call, at the end of a turn, or during stand-by (at most 10 minutes). A message nobody picks up within 2 hours expires.
- A permission request waits at most 5 minutes in the office before the terminal dialog takes over.
- The plugin is loaded when a Claude Code session starts, so sessions already open need a restart after install or update.

## Next

- [Architecture](07-architecture.md): how the pieces fit.
- [Privacy and security](05-privacy-and-security.md)
- [Troubleshooting](08-troubleshooting.md): performance and detection problems.
- [Contributing](../CONTRIBUTING.md) and [AGENTS.md](../AGENTS.md): the checks expected of a change.
