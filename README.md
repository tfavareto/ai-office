**English** · [Português (Brasil)](README.pt-BR.md) · [Español](README.es.md)

<a id="top"></a>

<p align="center">
  <picture>
    <source media="(prefers-reduced-motion: reduce)" srcset="docs/assets/readme/hero-still.svg" />
    <img src="docs/assets/readme/hero.svg" alt="AI Office: a pixel-art office where Claude Code agents work at their desks, with status lights for working, needs you and running a shell." width="1600" />
  </picture>
</p>

# AI Office

**Your Claude Code agents, at work in a live office.**

AI Office turns the Claude Code sessions running on your computer (and your Codex sessions) into a corporate office you can watch in real time. Every project becomes a room, every session is a person at a desk, and subagents are colleagues who walk into the meeting room, work and leave.

You see who is working, who needs you and who is waiting on a shell. You answer permission requests, send instructions and review your day without switching terminals. **Everything runs on `127.0.0.1`; nothing leaves your computer unless you turn on an opt-in feature.**

<p align="center">
  <a href="#install"><strong>INSTALL WITH ONE PROMPT →</strong></a>
  &nbsp; · &nbsp;
  <a href="#try-the-demo">TRY THE DEMO</a>
  &nbsp; · &nbsp;
  <a href="#views">SEE IT IN 3D</a>
  &nbsp; · &nbsp;
  <a href="docs/README.md">READ THE DOCS</a>
</p>

<p align="center">
  <a href=".github/workflows/ci.yml"><img src="https://github.com/tfavareto/ai-office/actions/workflows/ci.yml/badge.svg" alt="CI status on GitHub Actions" /></a>
  &nbsp;
  <a href="LICENSE"><strong>MIT</strong></a>
  &nbsp; · &nbsp;
  <a href="#community">Star History</a>
  &nbsp; · &nbsp;
  <a href="docs/06-validation.md">Evidence and limits</a>
</p>

<p align="center">
  <strong>Claude Code</strong> CLI + desktop / <strong>Codex</strong> / several accounts / <strong>macOS + Linux</strong>
  <br />
  <strong>2D pixel art</strong> by default / optional <strong>3D</strong> / 100% local
  <br />
  Interface in <strong>English</strong>, <strong>Português</strong> and <strong>Español</strong>
</p>

---

<a id="start-here"></a>

## 00 / Choose where to start

| Your situation | Path | What you get |
|---|---|---|
| **I want to see it first** | [Run the demo](#try-the-demo) | A full office with simulated agents, no Claude Code needed |
| **I want my agents in the office** | [Install with one prompt](#install) · [Prompt 01](docs/prompts/01-install-and-run.md) | Server running, plugin installed, office open in your browser |
| **I want it always on** | [Prompt 02](docs/prompts/02-run-at-login.md) | AI Office starts at login (launchd on macOS, systemd on Linux) |
| **I use more than one Claude account** | [Prompt 04](docs/prompts/04-multiple-accounts.md) | Every account in the same office, plugin installed in each one |
| **I want to start agents from the office** | [Run your team](#team) | Hire agents at empty desks, triage the inbox, follow the task board, automate approvals |
| **I want to know where my tokens and time go** | [Usage, reports and Git](#insights) | Usage by day, week and month, limit forecast, day report, Git state per room, time-lapse |
| **I want the office to feel alive and mine** | [An office with personality](#delight) | Celebrations, interactions, levels and decor, customization, a share card |
| **I use Codex too, or work with a team** | [Codex and team mode](#reach) | Codex sessions in the same office; several computers in one office over the local network |
| **Something is not working** | [Troubleshooting](docs/08-troubleshooting.md) · [Prompt 05](docs/prompts/05-troubleshoot.md) | A read-only diagnosis first, then fixes you approve |
| **I want to contribute** | [Contributing](CONTRIBUTING.md) · [Prompt 07](docs/prompts/07-contribute.md) | Dev setup, checks and conventions |

**On this page:** [Install](#install) · [Agents](#watch) · [Permissions and messages](#direct) · [Your team](#team) · [Insights](#insights) · [Personality](#delight) · [Codex and team](#reach) · [2D and 3D](#views) · [How it works](#how-it-works) · [Privacy](#privacy) · [Prompts](#prompts) · [Configuration](#configuration) · [Evidence](#evidence) · [Repository](#repository) · [Community](#community).

<a id="install"></a>

## 01 / Install with one prompt

Open Claude Code (or Codex, or any agent with terminal access) in any folder and paste:

```text
Read https://raw.githubusercontent.com/tfavareto/ai-office/main/docs/prompts/01-install-and-run.md and execute the entire block in the "Prompt" section on this computer.
```

The agent follows a fixed recipe and asks before anything destructive:

1. **Check:** Node.js 22 or newer, npm, git and the `claude` CLI.
2. **Get the code:** clone this repository (default `~/ai-office`), then `npm install` and `npm run build`.
3. **Start:** run the server in the background and confirm `http://127.0.0.1:4848/api/health` answers.
4. **Connect:** install the Claude Code plugin in every account it finds.
5. **Open:** the office in your browser, and offer to start it at login.

<a id="manual-install"></a>

### Prefer to do it by hand?

```bash
git clone https://github.com/tfavareto/ai-office.git
cd ai-office
npm install
npm run build
npm start                 # http://127.0.0.1:4848
```

In a second terminal, connect Claude Code:

```bash
npm run plugin:install    # also: plugin:status, plugin:uninstall
```

Sessions that were already open pick the plugin up after `/reload-plugins` or a restart. The [installation guide](docs/01-installation.md) covers updates, run at login and uninstalling.

<a id="try-the-demo"></a>

### Try the demo

```bash
AI_OFFICE_DEMO=1 npm start
```

Demo mode fills the office with realistic simulated sessions: people walk in, work, ask for permissions and finish. You can also turn it on later in **Settings**.

<a id="watch"></a>

## 02 / See every agent at a glance

<p align="center">
  <img src="docs/assets/readme/en/office-demo.gif" alt="The 2D office in demo mode: agents walk between rooms, sit at their desks and change status." width="1200" />
</p>

The office reads what Claude Code already writes to disk and keeps up as it changes. There is nothing to configure per project.

| In Claude Code | In the office |
|---|---|
| A project you opened | A room with its own color, desks and task progress |
| A session | A person at a desk, with name, account and current activity |
| A subagent | A colleague who joins the meeting room and leaves when done |
| A long shell command | A cyan light and a timer, so you know it is not stuck |
| Several accounts | Usage per account: 5-hour window, week and today, in tokens and estimated cost |

Statuses are always shown with text as well as color:

| Status | Meaning |
|---|---|
| 🟢 **Working** | The turn is in progress |
| 🟠 **Needs you** | A permission, a question or a plan is waiting for you |
| 🔵 **Waiting for the shell** | A command is still running |
| ⚪ **Idle** | The turn ended; the session is open |
| 🔷 **Done** | A subagent finished and is leaving the office |

Click a person to see their summary, tasks, subagents, activity and session data. **My day** shows how long each agent spent in each status today, and the session history keeps the last seven days. The [user guide](docs/02-using-the-office.md) covers every panel and keyboard shortcut.

<a id="direct"></a>

## 03 / Answer and direct them without leaving the office

<p align="center">
  <picture>
    <source media="(prefers-reduced-motion: reduce)" srcset="docs/assets/readme/plugin-flow-still.svg" />
    <img src="docs/assets/readme/plugin-flow.svg" alt="Permission flow: the agent asks, the plugin hook shows a card in the office and your answer goes back to the agent. Message flow: your instruction waits in a queue and reaches the agent after its next tool call or when its turn ends." width="1600" loading="lazy" />
  </picture>
</p>

The `ai-office` plugin adds Claude Code hooks that talk to the local server. If AI Office is not running, the hooks exit at once and Claude Code behaves exactly as before.

| You want to | In the office | What reaches Claude Code |
|---|---|---|
| **Approve a tool** | **Approve**, or **Approve and don't ask again** | The decision, as if you had answered in the terminal |
| **Refuse a tool** | **Deny**, with an optional reason and interrupt | The refusal and your reason, in your language |
| **Steer an agent** | Type in **Messages**, or pick a quick message | Your text after its next tool call, or as a new instruction when its turn ends |
| **Talk to a whole room** | The room's team message | One message per agent, tracked as "2 of 3 delivered" |
| **Follow the conversation** | The read-only terminal (`T`) | Nothing: it only reads |

The terminal dialog keeps working: whichever answer comes first wins. Every message shows its state: **Queued**, **Delivered while working**, **Delivered as a new instruction** or **Expired** (after 2 hours).

<table>
  <tr>
    <td width="50%"><img src="docs/assets/readme/en/agent-drawer.png" alt="Agent drawer with a pending permission card and the Approve, Approve and don't ask again, Deny and Answer in the terminal buttons." /></td>
    <td width="50%"><img src="docs/assets/readme/en/terminal.png" alt="Read-only terminal panel showing a session's prompts, replies and tool calls." /></td>
  </tr>
  <tr>
    <td align="center"><sub>Permission requests appear on top of the agent's card</sub></td>
    <td align="center"><sub>The read-only terminal follows any session live</sub></td>
  </tr>
</table>

The [plugin guide](docs/03-plugin.md) details each hook, the delivery paths and the 10-minute stand-by.

<a id="team"></a>

## 04 / Run your team from the office

<table>
  <tr>
    <td width="50%"><img src="docs/assets/readme/en/inbox.png" alt="The inbox lists every permission request waiting on you, groups identical ones under Approve all similar and flags risky commands." /></td>
    <td width="50%"><img src="docs/assets/readme/en/task-board.png" alt="The task board shows every agent's tasks in Pending, In progress and Completed columns, with the agent, room and age on each card." /></td>
  </tr>
  <tr>
    <td align="center"><sub>One inbox for everything that waits on you</sub></td>
    <td align="center"><sub>Every agent's tasks on one board</sub></td>
  </tr>
</table>

The office is also where work starts and where you keep it moving, without hopping between terminals.

| You want to | In the office | What happens |
|---|---|---|
| **Start a new agent** | Click an empty desk, **Hire an agent** in a room, or `H` | A new terminal window opens with Claude Code in that folder, with your first task, model and permission mode; a person walks to the desk and takes over when the session starts |
| **Clear what waits on you** | The **Inbox** (`I`) | Permissions, questions, errors and finished agents in priority order; **Approve all similar** for identical requests, keyboard triage, risky commands never approved in bulk |
| **See all the work** | The **Task board** (`K`) or the meeting-room whiteboard | Every agent's tasks in **Pending**, **In progress** and **Completed**; dragging a card writes a message to the agent, which you review before sending |
| **Stop answering the same question** | **Create rule…** on any request, or **Settings → Automation and personalization → Approval rules** | Recurring requests (say, `npm test` in one project) are answered at once and logged; risky or compound commands always come to you |

Hiring needs the page open on this computer and opens your usual terminal (Terminal or iTerm on macOS, your desktop terminal on Linux). The [user guide](docs/02-using-the-office.md) covers each one, and the [plugin guide](docs/03-plugin.md) explains how rules answer requests.

<a id="insights"></a>

## 05 / Know where your tokens and your day went

<table>
  <tr>
    <td width="50%"><img src="docs/assets/readme/en/usage.png" alt="The Usage dialog: total tokens, estimated cost, change against last week and cache reuse, a daily chart split by token type and the limit forecast." /></td>
    <td width="50%"><img src="docs/assets/readme/en/day-report.png" alt="The day report: agents, active time, files, commits, tests, tasks and cost for the day, highlights and a section per project." /></td>
  </tr>
  <tr>
    <td align="center"><sub>Usage today, this week and this month, with a limit forecast</sub></td>
    <td align="center"><sub>A day report you can copy or download as Markdown</sub></td>
  </tr>
</table>

Everything here is computed on your computer from the files Claude Code already writes.

| You want to | In the office | What you get |
|---|---|---|
| **See where the tokens went** | Click a usage card in the top bar, or `U` | **Usage** for today, this week and this month, per account or all: tokens by type, estimated cost, change against the previous period, cache reuse, a chart by hour or day, and breakdowns by model, project and session |
| **Avoid hitting the limit by surprise** | **Limit forecast** in the same dialog | How far your current pace takes you by the end of the 5 h window and the week, and roughly when you would reach your limit; the usage card turns amber when it is under 30 minutes away. Plans do not expose their limits locally, so enter yours in **Limits (optional)** or the forecast uses your highest recent block |
| **Write today's status update** | **My day → Report** (`R`) | What each agent did: files changed, commands, tests passed and failed, commits, tasks closed, time and cost, for today or any of the last 6 days; **Copy Markdown** or **Download .md**. Your prompts stay out unless you include them |
| **Know the state of each repository** | The room drawer, the sidebar and the sign on the room's door | Branch, uncommitted changes, ahead and behind, last commit, rebase or merge in progress. Pull requests and CI status are optional and off by default: turning them on is the only feature that goes online, through your own `gh` CLI |
| **Catch up on what happened while you were away** | **My day → Watch the day** (`L`) | The day replayed in the office at up to 1800× speed, with a timeline you can scrub and markers for arrivals, commits, failed tests and permission waits |

<p align="center">
  <img src="docs/assets/readme/en/timelapse-2d.png" alt="The day replay: the 2D office as it was at 6:52 AM, with a timeline of arrivals, commits, failed tests and permission waits along the bottom and a Back to live button." width="1200" loading="lazy" />
  <br />
  <sub>Watch the day: the office replayed from the first session, with markers on the timeline</sub>
</p>

The [user guide](docs/02-using-the-office.md) details each view; the [privacy guide](docs/05-privacy-and-security.md) lists what the usage index and the report keep on disk (numbers per project and session, never conversation text).

<a id="delight"></a>

## 06 / An office with personality

<p align="center">
  <img src="docs/assets/readme/en/celebration.gif" alt="An agent finishes its tasks: confetti bursts from both sides, the person jumps with arms up and the colleagues in the room clap." width="1200" loading="lazy" />
</p>

The office reacts to the work, not only to the status, and it becomes yours over time.

| What | How it shows up |
|---|---|
| **People act out their work** | Reading holds a page, editing types fast with tiny code glyphs, a long shell leans back and taps, thinking shows a bubble, waiting for you raises a hand, repeated errors scratch the head, idle agents take a coffee break |
| **Celebrations** | Tests passing after a failure, a finished task list, a commit or a merged pull request set off confetti from both sides, a jump and colleagues clapping; a room that finishes everything gets a confetti shower. **Settings → Office → Celebrations**; reduced motion shows a quiet star instead |
| **Agents interact** | Handshakes with subagents in the meeting room, chats at the pantry, ping-pong in the lounge, high fives and waves in the corridor; real work always interrupts them |
| **The office grows** | **Achievements** (`C`): ten office levels from your sessions, tasks, commits, tests and streaks, 22 badges, an employee of the month, and decor that unlocks level by level, from wall art and an aquarium to a trophy cabinet, a neon sign and an office cat |
| **Make it yours** | **Customize** on any agent or room: names, skin, hair, outfit and accessories (the same in 2D and 3D), per agent, room or account; room alias, floor, walls, plants and sign; **Arrange rooms** to reorder, pin or hide them |
| **Share your day** | **My day → Share**: a branded image of today's office with agents, active time, tasks, commits and tests, in 1200×630 or 1080×1080, light or dark, with a caption ready for LinkedIn or X. Project names and costs stay out unless you add them |

<p align="center">
  <img src="docs/assets/readme/en/share-card.png" alt="A share card: the office from above with the day's agents, active time, tasks done, commits and tests passed, and the repository link." width="900" loading="lazy" />
</p>

<a id="reach"></a>

## 07 / Bring Codex and your team

| What | How it works |
|---|---|
| **Codex sessions** | Sessions of the OpenAI Codex CLI and desktop app (`~/.codex`, or `CODEX_HOME`) appear in the same office with a **Codex** badge; agents working in the same folder share the room with Claude Code agents. Status, activity, usage, cost estimates, the day report and the time-lapse include them. Codex has no hooks, so permissions and messages stay Claude-only: Codex agents are read-only. **Settings → Data and integrations → Show Codex sessions** |
| **Team mode** | Several computers in one office over your local network. One computer **hosts a team** and shows a single-use code that expires in 10 minutes; the others **join** with the address and the code. Off by default, on a separate listener that speaks only the team protocol; pairing is authenticated, traffic is encrypted, and the host can remove members at any time |
| **What a teammate sees** | Names, status and the kind of activity, in read-only rooms such as "Ana · Project 1". Project names, activity details, branches, tokens and cost are shared only when each person turns that category on |

The [team mode spec](docs/spec/08-team-mode.md) documents the threat model, the protocol and its known limits; the [privacy guide](docs/05-privacy-and-security.md) summarizes what leaves your computer and when.

<a id="views"></a>

## 08 / 2D by default, 3D when you want it

<table>
  <tr>
    <td width="50%"><img src="docs/assets/readme/en/office-2d-day.png" alt="The 2D pixel-art office by day: reception, pantry, meeting room, lounge, restrooms and one room per project." /></td>
    <td width="50%"><img src="docs/assets/readme/en/office-3d-night.png" alt="The 3D office at night: an isometric view of the floor on top of a lit tower in a city." /></td>
  </tr>
  <tr>
    <td align="center"><sub>2D pixel art, the default</sub></td>
    <td align="center"><sub>3D, one click away in the settings</sub></td>
  </tr>
</table>

Both views share the same building, the same people and the same interface; only the rendering changes. Switch in **Settings → General → Visual**, and it applies at once.

| | 2D (default) | 3D (optional) |
|---|---|---|
| **Look** | Hand-made pixel art: walnut, marble, brass, plants and a city around the building | Lit 3D tower with real-time shadows, glass, city traffic and 3D characters |
| **Camera** | Pan, smooth zoom and overview, with one zoom-out step past the overview so the building always fills the view | **Overview**, **First person** and **Over the shoulder** |
| **Day and night** | Follows your local time, or fixed day or night | Same, with night glow on the windows and signs |
| **Cost** | Very light: hundreds of frames per second of headroom | Heavier, mainly at night: [measured numbers](docs/06-validation.md) |
| **Loads** | Immediately | On demand, the first time you switch |

<a id="how-it-works"></a>

## 09 / How it works

<p align="center">
  <picture>
    <source media="(prefers-reduced-motion: reduce)" srcset="docs/assets/readme/how-it-works-still.svg" />
    <img src="docs/assets/readme/how-it-works.svg" alt="Claude Code sessions write files under ~/.claude; the AI Office server on 127.0.0.1:4848 reads them, derives each agent's status and streams it live to the office in your browser. Plugin hooks talk to the same server for permissions and messages." width="1600" loading="lazy" />
  </picture>
</p>

1. **Read:** the server watches the session registry and conversation files of every Claude Code account on this computer, read-only.
2. **Understand:** it derives each agent's status, activity, tasks, subagents, shells, tokens and estimated cost.
3. **Stream:** the office receives a live snapshot over Server-Sent Events and animates the change.
4. **Act:** plugin hooks deliver your permission answers and messages back to the right session.

| Package | Role |
|---|---|
| [`packages/server`](packages/server/README.md) | Node.js HTTP server with no framework: reading, status, HTTP and SSE API, the web app |
| [`packages/web`](packages/web) | The interface, the 2D world (Canvas 2D) and the 3D world (three.js, loaded on demand) |
| [`packages/plugins`](packages/plugins/ai-office/README.md) | The Claude Code plugin (hooks) and its installer |
| [`packages/shared`](packages/shared) | Types, protocol and the demo simulator shared by everything |

The [architecture guide](docs/07-architecture.md) and the [specs](docs/spec/00-product.md) go deeper.

<a id="privacy"></a>

## 10 / Private by design

<p align="center">
  <picture>
    <source media="(prefers-reduced-motion: reduce)" srcset="docs/assets/readme/privacy-still.svg" />
    <img src="docs/assets/readme/privacy.svg" alt="Claude Code files, the AI Office server, the browser and the plugin all stay inside the 127.0.0.1 boundary; nothing goes to the internet." width="1600" loading="lazy" />
  </picture>
</p>

AI Office was built for code you may not want to share. It sends nothing anywhere, except through two opt-in features that are off by default: looking up pull requests through your own `gh` CLI, and team mode, which shares a sanitized view with the computers you pair on your local network.

| Protection | How |
|---|---|
| **Local only** | Binds to `127.0.0.1`; any other address is refused unless you opt in with `AI_OFFICE_ALLOW_REMOTE=1` |
| **Numbers, not conversations** | The usage index and the day report keep token counts, costs, file names and commands; prompts and replies are never stored |
| **Read-only on Claude Code** | Reads session files; it never edits them |
| **Authenticated** | A random token in `~/.ai-office/token` (mode 0600); the page gets an HttpOnly cookie, the hooks prove they hold the token |
| **Hardened browser surface** | Strict Content Security Policy, cross-site requests rejected, framing denied |
| **Safe hooks** | Short timeouts; if the server is down, Claude Code continues normally |

Read the [privacy and security guide](docs/05-privacy-and-security.md), and report vulnerabilities privately as described in [SECURITY.md](SECURITY.md).

<a id="prompts"></a>

## 11 / Prompts for every step

Pick a task, open the prompt and paste the indicated block into an agent with terminal access. The [catalog](docs/prompts/README.md) explains each one.

| Goal | Prompt | When to use |
|---|---|---|
| **Install and run** | [01 · Install and run](docs/prompts/01-install-and-run.md) | First time on this computer |
| **Keep it running** | [02 · Run at login](docs/prompts/02-run-at-login.md) | You want the office always available |
| **Stay current** | [03 · Update](docs/prompts/03-update.md) | Pull, rebuild, restart and refresh the plugin |
| **Several accounts** | [04 · Multiple accounts](docs/prompts/04-multiple-accounts.md) | More than one `~/.claude*` folder |
| **Fix a problem** | [05 · Troubleshoot](docs/prompts/05-troubleshoot.md) | Something looks wrong; diagnose before changing |
| **Remove it** | [06 · Uninstall](docs/prompts/06-uninstall.md) | Plugin, service and data, each with confirmation |
| **Contribute** | [07 · Contribute](docs/prompts/07-contribute.md) | Set up the dev loop and ship a tested change |

<a id="configuration"></a>

## 12 / Configure it your way

Defaults work for most people. Set environment variables (or the matching flags) only when you need to:

| Variable | Default | Meaning |
|---|---|---|
| `AI_OFFICE_PORT` | `4848` | HTTP port; the plugin uses the same variable |
| `AI_OFFICE_HOST` | `127.0.0.1` | Bind address; anything else requires `AI_OFFICE_ALLOW_REMOTE=1` |
| `AI_OFFICE_CLAUDE_DIRS` | every `~/.claude*` with sessions | Claude Code folders, one per account, comma-separated |
| `AI_OFFICE_STATE_DIR` | `~/.ai-office` | Names, day records and the local access token |
| `AI_OFFICE_DEMO` | off | Start with demo sessions |
| `AI_OFFICE_LOG` | normal | `quiet` or `debug` |

Interface preferences live in **Settings**, grouped into sections you can expand or collapse (**General** with language, visual and day and night first, then office, sounds and notifications, data and integrations, automation and personalization, team, demo and about), and are saved in your browser. The [configuration guide](docs/04-configuration.md) lists everything, including hook settings.

<a id="language"></a>

### Your language

The whole interface (panels, statuses, activities, notifications, room names and the signs inside the office) is available in **English**, **Português (Brasil)** and **Español**. Pick one in **Settings → General → Language**, or leave **Automatic (system)** to follow your browser. The switch is instant and keeps your selection, open panels and camera.

Text that comes from your own sessions (prompts, task titles, commands, file names) is shown as written. When you answer a permission or send a message, the plugin tells the agent in your language.

<a id="evidence"></a>

## 13 / Evidence and limits

| Check | How |
|---|---|
| **Types** | TypeScript strict across the four packages: `npm run typecheck` |
| **Behavior** | 3100+ Vitest tests, including an end-to-end suite that boots the real server: `npm test` |
| **Style** | ESLint and Prettier: `npm run lint` |
| **Build** | Web bundle and server bundle: `npm run build` |
| **Documentation** | Every local link, anchor and README translation checked: `npm run docs:check` |
| **Continuous integration** | All of the above on Ubuntu and macOS, Node.js 22 and 24 |

Frame rate measured in the real app with live sessions (4 agents in 4 rooms), 1440×900 at 2× pixel ratio, vsync off to show the headroom:

| View | Day | Night |
|---|---|---|
| 2D | 427 fps | 385 fps |
| 3D, full quality | 83 fps | 21 fps |

Your screen caps what you see (usually 60 fps). The 3D night scene is the expensive one: its glow pass with anti-aliasing at a 2× pixel ratio accounts for most of the cost. The [validation guide](docs/06-validation.md) records the machine, the method and the known limits, such as cost figures being estimates and Windows not being supported.

<a id="repository"></a>

## 14 / Explore the repository

```text
ai-office/
├── README.md                You are here (also in Português and Español)
├── AGENTS.md                Instructions for coding agents (CLAUDE.md points here)
├── docs/                    Guides, evidence and copyable prompts
│   ├── prompts/             Install, run at login, update, troubleshoot…
│   ├── spec/                Product and technical specification
│   └── assets/readme/       Images used on this page
├── packages/
│   ├── server/              Local HTTP + SSE server
│   ├── web/                 Interface, 2D and 3D worlds
│   ├── plugins/             Claude Code plugin and installer
│   └── shared/              Shared types, protocol, demo simulator
└── scripts/                 Repository checks
```

| Guide | Purpose |
|---|---|
| [Overview](docs/00-overview.md) | The mental model, statuses and principles |
| [Installation](docs/01-installation.md) | Requirements, install, update, run at login, uninstall |
| [Using the office](docs/02-using-the-office.md) | Every panel, setting and shortcut |
| [Plugin](docs/03-plugin.md) | Hooks, permissions, messages and notifications |
| [Configuration](docs/04-configuration.md) | Variables, flags, accounts and demo mode |
| [Privacy and security](docs/05-privacy-and-security.md) | What is read, what is stored, how access is protected |
| [Evidence and limits](docs/06-validation.md) | Checks, measurements and known limits |
| [Architecture](docs/07-architecture.md) | Packages, data flow and design decisions |
| [Troubleshooting](docs/08-troubleshooting.md) | Symptoms, causes and fixes |

### Verify this checkout

```bash
npm install
npm run typecheck && npm run lint && npm test && npm run build
npm run docs:check
```

<a id="community"></a>

## 15 / Follow the project

If AI Office made your agents easier to follow, a star helps other people find it.

<a href="https://www.star-history.com/?repos=tfavareto%2Fai-office&amp;type=date">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/chart?repos=tfavareto/ai-office&amp;type=date&amp;theme=dark" />
    <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/chart?repos=tfavareto/ai-office&amp;type=date" />
    <img src="https://api.star-history.com/chart?repos=tfavareto/ai-office&amp;type=date" alt="Star history for tfavareto/ai-office, provided by Star History." width="1000" loading="lazy" />
  </picture>
</a>

[Report a bug](https://github.com/tfavareto/ai-office/issues/new/choose) · [Suggest an improvement](https://github.com/tfavareto/ai-office/issues/new/choose) · [Contribute](CONTRIBUTING.md)

The chart is provided by [Star History](https://www.star-history.com) and depends on that service. Screenshots in issues and pull requests should come from demo mode, never from real sessions.

<a id="license"></a>

## Credits and license

The 3D world uses public-domain (CC0) assets from [Poly Haven](https://polyhaven.com), [Kenney](https://kenney.nl) and [MakeHuman](https://www.makehumancommunity.org); see the [asset credits](packages/web/public/assets/3d/CREDITS.md). The 2D pixel art is drawn in code.

Licensed under [MIT](LICENSE). By Thiago Salazar Favareto.

<p align="center">
  <strong>WATCH THEM WORK. STEP IN WHEN IT MATTERS.</strong>
  <br />
  <a href="#top">Back to top ↑</a>
</p>
