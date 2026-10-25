# AI Office — product spec

AI Office is a local web app that turns the Claude Code sessions running on this computer into a live corporate
office. Every open project is a room; every session is a person working in it; subagents are colleagues who arrive,
work and leave. The user watches what each agent is doing in real time, answers permission requests, sends messages
("orders") to agents and reviews the day.

Audience: developers using Claude Code (CLI or desktop) on macOS/Linux, often with more than one account. UI languages:
**English, Brazilian Portuguese and Spanish** (all visible text), chosen in Settings or taken from the browser; pt-BR is
the source catalog the other two are translated from. Code, comments and docs in the repo: English.

## Principles
- **Local and private.** The server reads Claude Code files on this machine and binds to 127.0.0.1 by default. Nothing
  leaves the computer. Features that act on sessions (terminal view, permissions, messages) only work when the page is
  opened locally (Host is localhost/127.0.0.1).
- **Never break Claude Code.** Hooks exit fast and silently when AI Office is not running; they never block a session.
- **Smooth.** 60 fps target in the default (2D) view on a MacBook; no main-thread stalls over 100 ms after load. 3D is
  an optional visual.
- **Speaks your language.** Every visible string comes from a catalog with the same keys in pt-BR, en and es; the
  language switches live and never changes text that comes from the user's own sessions.
- **Delightful.** Premium corporate look (warm walnut, marble, brass, glass, plants), lively but calm characters,
  readable at a glance.

## Feature list (all required for 1.0)
1. **Office view (2D default, 3D optional)**: building with core areas (Reception, Pantry, Meeting room, Restrooms,
   Lounge) and one room per open project; people walk, sit at desks, gather, react to status. Day/night cycle by local
   time (auto/day/night setting). Click a person or room to open details; double-click focuses camera. Pan (drag/WASD/
   arrows), zoom (wheel/+/-), "Overview" (O).
2. **Top bar**: brand "AI Office" (logo + wordmark), connection pill, counters (rooms, agents, working,
   subagents, shells running, need you; the last two clickable to jump to the next one), usage cards per
   account (tokens and estimated cost: 5h window, week, today; they shrink to a compact form when space is short and
   collapse into a "+N" button that opens a popover with all of them; every card is a button that opens the **Consumo** dialog, and gets an amber ring when the projected limit is less than 30 minutes away), buttons: overview, zoom, notifications (bell with
   unread badge), My day, session history, feed, settings, help.
3. **Sidebar**: search (agent, project, account; "/" focuses), account filter chips, list of rooms with their agents
   and subagents (avatar, name, account chip, role, current activity, status dot, elapsed time for long shells), room
   task progress.
4. **Details drawer** (agent): hero (avatar, name, role, account, room link), title, status row (status + since,
   actions: Message, Follow, Center, Terminal), urgent cards always on top (permission request card with
   Approve / Approve and don't ask again / Deny (reason, interrupt) / Answer in the terminal; "Needs you"
   alert; "Waiting for the shell" card), then tabs: **Summary** (KPI tiles in a 2x2 grid: tools, tokens, time in
   session, cost; Now; Tasks; Subagents/Owner), **Messages** (composer + history), **Activity** (running
   shells, timeline), **Data** (stats list, model, branch, permission mode, session id copy, start, duration). Room
   drawer: hero (color, name, path copy), accounts, agents list, team message composer, tasks, recent activity.
5. **Feed**: collapsible bottom panel with the latest activities of the whole office.
6. **Toasts + notification center**: toasts for notices (alerts persist until resolved; dedupe repeats); bell popover
   with history, filters (All / Needs you / Messages), unread badge, "Do not disturb" (only alerts toast/sound),
   clear. Optional browser notifications for alerts when the tab is hidden. Tab title shows "(n) AI Office" when n
   agents need the user.
7. **Messages to agents**: composer with quick chips ("How is it going? Give me a quick summary.", "Stop and explain the plan to me before
   continuing.", "Run the tests before continuing.", "You can wrap up and send me a summary."), Cmd/Ctrl+
   Enter sends, status per message (Queued / Delivered while working / Delivered as a new instruction / Expired),
   team message to all agents of a room (grouped history "2 of 3 delivered"), key N opens it. Delivery via plugin hooks
   (PostToolUse adds additionalContext; Stop blocks with the message as reason; Stop waits up to 10 min "on standby"
   when a page is open). The page sends its language (`locale`) with each message, and the hook phrases its preamble in
   it; the message text itself is delivered untouched.
8. **Permission answers**: the plugin's PermissionRequest hook sends requests; the page shows them (P jumps to next,
   and the inbox below lists them all);
   the terminal dialog still works (first answer wins). The page sends its language (`locale`) with the decision, and
   the hook phrases the fixed part of a denial message in it.
9. **Read-only terminal**: panel that renders a session's conversation like the terminal (user prompts, assistant
   text, collapsed thinking, tool calls with summaries and results), live-updating, search (Ctrl/Cmd+F). T toggles for
   the selected agent. Session history popover: sessions of the last 7 days grouped by day, searchable; opens closed
   sessions read-only.
10. **My day**: dialog with two tabs. **Time**: time per status per agent (bar per agent + totals), from the server's day recorder. **Report** (`R`): what each agent did on today or one of the six days before it, built from the transcripts and the usage index: headline numbers (agents, active time, files changed with lines, commits, test runs passed or failed, tasks completed, tokens and estimated cost), a half-hour activity strip, highlights ("Ana closed 4 tasks and made 3 commits in loja-online") and sections per project or per agent. Exports as Markdown (copy, or `ai-office-<date>.md`) in the interface language. Prompts are never included unless the user turns on "Include the requests" (first line of each, off by default).
11. **Settings**: language (Automatic (system) / English / Português (Brasil) / Español; switches live, keeping
    selection, panels and camera; "Automatic" resolves from the browser languages: pt → Português, es → Español,
    otherwise English), visual (2D/3D; applies immediately), day and night (automatic/day/night), names above people,
    bubbles (all/important/none), animation (calm/normal/lively), celebrations (on/off), sounds (on/off + volume), browser notifications,
    demo mode (fake agents), about (version). Preferences live in the browser.
12. **Help**: legend (statuses, icons), shortcuts, how to install the plugin.
13. **Demo mode**: fake sessions that behave realistically (screenshots, first run with no sessions); the demo accounts also get ten weeks of believable hourly usage history. `?mock=1` runs a
    fully client-side simulation without a server.
14. **Claude Code plugin**: one plugin "ai-office" (marketplace in this repo) with hooks: PermissionRequest (answer from
    the office), PostToolUse + Stop + SubagentStop (deliver messages), Notification (mark "needs you").
    `npm run plugin:install|uninstall|status` installs into every detected account via the `claude plugin` CLI.

15. **Needs-you inbox** ("Fila do que precisa de você"): the "need you" counter of the top bar is the button of one
    prioritized list of everything that waits on the user (key I). Order: pending permission requests (soonest to
    expire first), then questions, plan approvals and attention notices (oldest first), then errors (the last action
    failed), then agents that finished (newest first). Permissions are answered in place (Approve, Approve and don't
    ask again, Deny with an optional reason, Answer in the terminal); the other kinds open the agent, because they
    are answered in the terminal, and can be marked as seen. "Finished" means a main agent that went idle after
    working since the page first saw the office, and it counts as seen when its agent is opened. Bulk triage:
    multi-select (checkboxes, Shift+click ranges), Approve selected, Deny selected, and "Approve all similar" for
    identical requests (same tool and the same normalized command; file edits match by folder and extension; web
    fetches by host). Every bulk action asks for confirmation and lists what it will do and what it leaves out.
    Dangerous requests (recursive deletes, sudo, forced pushes, hard resets, recursive chmod, piping a download into
    a shell, disk and database wipes, writes to secrets and system files) carry a warning badge, are never part of a
    bulk approval or a "similar" group, and cannot be remembered as a rule. The seen marks live in this browser only
    (`ai-office:inbox`). Sound and notifications are unchanged. Demo mode raises identical, similar and dangerous
    permission requests, up to four at once.

16. **Approval rules** ("Regras de aprovação"): teach the office to answer recurring permission requests on its own,
    safely and visibly. A rule approves or denies by tool plus a matcher (the command starts with `npm test`; a file
    glob such as `src/**`; a website; any request of a read-only or single MCP tool), for all projects or one project
    and optionally one account, and can carry a note (denials tell the agent why). Rules are created from "Criar
    regra…" on a permission card or an inbox row, pre-filled from the request (tool, normalized command prefix or folder
    glob, this project) and editable before saving, with a live preview of how many of today's requests the rule would
    have answered; they are managed in a dialog (Settings → "Regras de aprovação", or the shield button of the inbox):
    switch on/off, edit, delete with confirmation, hit count and last use, and a log tab of every automatic decision with
    filters. Deny rules win over allow rules, the most specific scope wins, disabled rules are ignored, and a matched
    request is answered immediately and left as a quiet line in the agent's activity ("Regra aprovou: npm test").
    Safety is not negotiable: dangerous requests are never auto-approved even when an allow rule matches (the person is
    asked, and the log says why), allow rules cannot be created or edited into something that would cover dangerous
    commands (`any` on Bash, `rm`, `sudo`, `git push`...) or compound commands (`;`, `&&`, `||`, `|`, backticks, `$(`,
    redirections), and unmatched requests behave exactly as before. Demo and `?mock=1` requests go through the same
    engine.

16. **Hire an agent**: the office is also a place to start work. Click an empty desk of a room (hover shows a dashed
    outline with a "+"), use the **Hire agent** button of the room drawer, the "+" of a room in the sidebar, the "+" at
    the top of the sidebar or `H`. A dialog asks for the project folder (an existing room, or **New project…** with a
    path field that validates the folder and suggests recent folders), the account (when there are several; default:
    the room's most recent one), an optional first task (≤ 8000 characters), the model (default / Opus / Sonnet / Haiku)
    and the permission mode (default / accept edits / plan). Cmd/Ctrl+Enter submits. The server opens a **new terminal
    window** running Claude Code in that folder (the person uses it normally; the office follows the session through its
    files, as always). Meanwhile a placeholder person ("arriving…") walks in from the elevator to the chosen desk, and
    hands over to the real session when it appears (matched by folder + account + start time, within 90 s). Local access
    only; in demo mode a simulated agent arrives instead and no terminal opens.
17. **Task board**: one board with the tasks of every agent (what Claude Code writes with TodoWrite / TaskCreate /
    TaskUpdate), opened from the top-bar button, `K` or by clicking the whiteboard of the meeting room. Three columns
    (**Pending / In progress / Completed**) or one lane per room; filters for room, account, agent and "active agents
    only". A card shows the task (the "doing…" form while in progress), who has it, the room, the account and its age
    (the server stamps `TaskItem.changedAt`); clicking it selects the agent and highlights the task in the drawer. Old
    completed cards fold away (the last 3 per room, "See all"). The board never edits a list itself: dragging a card to
    another column or to another agent (or `M` on a focused card, or the "+" of a column) opens a confirmation with the
    exact message, editable, and sends it as a normal message ("Prioritize this task now: …", "Take over this task: …
    (it came from Ana)", "Add this task to your task list: …"). The card says "message sent" until a snapshot shows the
    change. Agents without a task list are listed apart. The whiteboard of the meeting room (2D and 3D) shows the live
    summary: cards per column and the first tasks in progress.

18. **Consumo (usage)**: dialog opened from a usage card or with `U`. Account picker (each account and "All"), period tabs (Today / Week / Month), KPI tiles (total tokens, estimated cost, change against the same elapsed part of the previous period, cache hit share), stacked bars of the token types over time (hours for today, days for the week and the month), the open 5 h window of each account, a **limit forecast** (burn rate of the last 30-60 minutes projected to the end of the 5 h window and of the week, against a limit you type in or, without one, your highest recent block or week), and breakdown tables by model, project and session or subagent (people and rooms the office knows are links). Numbers come from a persisted, incremental hourly index of every transcript (previous month onwards, kept up to 13 months), computed locally. Everything is an estimate and says so.

19. **Git per room**: each room shows the state of its project's repository, read-only. The room drawer has a **Git**
    section (branch with a copy button, an operation in progress such as a rebase or merge, the changes as staged /
    modified / new / conflicted files with the lines added and removed, commits ahead of and behind the upstream, the last
    commit with its age, the stash); the sidebar row shows a compact branch line with a dot while work is uncommitted;
    hovering a room shows its branch on the map pill and in the tip. In the world each project room has a small **branch
    plaque** under its sign (2D pixel plate, 3D lettered plate with the operation word in the viewer's language), and a
    **CI light** (green, red or amber) when the branch has an open pull request. Pull requests and CI status come only from
    the person's own `gh` CLI and only when **Settings → Look up pull requests with gh (uses the internet)** is on; it is
    off by default and is the only feature that contacts GitHub. Without it nothing leaves the computer. **Show Git
    status** hides all of it. Folders that are not repositories (or computers without git) simply show nothing. The demo
    gives every room a different state (clean, dirty, ahead, behind, a rebase and a merge in progress, a detached HEAD,
    pull requests with passing, failing and running checks). The state is the optional `Project.git` field of the
    snapshot, also used by the day report for the commits of a day.

20. **Time-lapse of the day**: "Watch the day" in **Meu dia** (or `L`) replays today or any of the last six days at accelerated speed
    (30x, 120x, 600x, 1800x), to understand what happened while the person was away. The same 2D or 3D office is drawn from the day's
    events instead of the live stream: people walk in and out when their sessions began and went quiet, work, wait for a permission
    (the standing-with-a-hand pose), rest, run shells, call subagents who meet in the meeting room; rooms open and close with them and
    the light follows the time of day. A controls bar above the feed has play/pause (`Space`), the replay time in big digits, a scrubber
    over the day's active range with marks (commits, failed tests, waits for the person, arrivals; hover describes the mark under the
    pointer), the speeds, a day picker and **Back to live** (`Esc`). A violet top bar, a `REPLAY` pill and badge and a frame say it is
    the past. The page is read-only meanwhile (no messages, approvals, hiring, terminal, usage or inbox; the sidebar, the task board and
    the feed show the replayed moment). If agents need the person live, a note says so and takes them back. How the day is derived, and
    what is approximated, is in [02-server.md](02-server.md#day-time-lapse-apitimelapse). Demo mode tells a believable day (several
    rooms, subagent meetings, waits, commits, a failed test) for every day.

21. **Share card** ("Meu escritório hoje"): the **Share** button of **Meu dia** (header of the Time tab, toolbar of the Report tab) opens
    a dialog that makes a branded picture of the office and the numbers of a day, ready for LinkedIn or X, and free marketing for the
    open-source project. Formats 1200x630 and 1080x1080, dark (navy gradient, glass panels, brand blue) and light themes. The office is the
    hero (the 2D or the 3D renderer, whole building or what the camera shows now, with the day or night on screen); around it the AI Office
    logo and wordmark, the date, the headline numbers of the day report (agents, active time, tasks done, commits, passed test runs; tokens
    and estimated cost only when turned on), one highlight sentence and `github.com/tfavareto/ai-office`. **Download PNG**
    (`ai-office-<date>.png`), **Copy image** (async clipboard, with a message when the browser cannot) and a localized caption to paste
    ("Hoje meu time de agentes do Claude Code fechou 23 tarefas e 9 commits no AI Office ...") with its own copy button. Privacy by default:
    rooms are labelled "Room 1", "Room 2"... and no project name, agent title, task text, branch or prompt is drawn or written unless
    **Show project names** is on. Works in demo mode, in pt-BR, English and Spanish. Details in [04-ui.md](04-ui.md#share-card-dialog) and
    [03-world-2d.md](03-world-2d.md#world-api).

22. **An office that grows** ("Conquistas"): the office gains levels, achievements and decoration with the work the agents really do,
    counted from the session transcripts and the usage index, locally, and shown with charm rather than noise. An XP formula over lifetime
    counters (sessions, work hours, tasks completed, commits, passing test runs, tokens, subagents, days worked) gives ten levels
    (Garage, Startup, Team, Office, Branch, Headquarters, Campus, Tower, Holding, Legend); the level never goes down. Each level from
    the second unlocks one piece of decoration, drawn in both worlds: framed wall art (2), the **Employee of the month** plaque on the
    reception desk (3), an aquarium in the lounge (4), a trophy cabinet in the reception that shows the cups earned (5), the office cat
    that wanders between the rooms (6), a neon "AI Office" sign (7), two more arcade machines (8), garland lights along the corridor (9)
    and a gold finish (10). Twenty-two achievements (first session, first commit, 100 tasks, 1,000 tasks, a 7-day streak, night owl,
    early bird, five agents at once, ten subagents in a day, the first time-lapse watched...) have a date and a how-to-earn text; the
    locked ones show their progress. "Employee of the month" is the agent with most completed tasks this month (the agent name only;
    the project name appears only if **Show the project in Employee of the month** is on). The **Conquistas** dialog (trophy button, `C`)
    shows the level and XP bar, the next unlock, the decoration, the employee of the month, the badges and the lifetime numbers; a level up
    or a new achievement gets one toast and a few sparkles. **Settings → Office evolution** turns decoration and toasts off (the plain
    office, nothing announced). Demo mode shows a believable level-six office with many badges and the cat. Details in
    [02-server.md](02-server.md#progress-apiprogress), [03-world-2d.md](03-world-2d.md#unlockable-decoration),
    [04-ui.md](04-ui.md#achievements-dialog-conquistas) and [06-world-3d.md](06-world-3d.md).

Keyboard: / search, F follow selected, T terminal, N message, P next permission, I inbox (inside it: J/K or arrows move,
Space select, A approve, Shift+A approve and remember, D deny, Enter open, E mark seen), M my day, R day report, U usage, C achievements, K task board (on a focused card: M moves it), O overview,
H hire an agent, L time-lapse of the day (in it: Space play/pause, arrows skip 1 min, Shift+arrows 10 min), [ sidebar, ] feed, ? help, Esc closes the topmost thing (terminal search, terminal, drawer/selection, then the time-lapse).

## Alive office: work animations, celebrations and encounters
- People look like what their agent is doing: reading a page, typing fast with tiny code glyphs, leaning back at a glowing terminal (and yawning during a long one),
  a pulsing globe on the web, a thought bubble while thinking, pointing toward the meeting room when delegating, a raised hand and an amber pulse when waiting for you,
  scratching the head with a "?" after repeated errors, stretching when idle.
- Good moments are celebrated, tastefully and in both worlds: tests that pass after a failure, a finished task list, a successful `git commit`, a merged pull request, a
  subagent that finishes well and a long work turn that ends. A confetti burst, a jumping person, a localized bubble ("Tudo pronto!"), clapping colleagues, an optional short
  synthesized sound (only when sounds are on) and, when the last task of a room is done, a confetti shower over the whole room. Celebrations are rationed per person and for the whole office.
- People interact: a main agent greets its subagent with a handshake in the meeting room and checks on it now and then, colleagues high-five when they celebrate together,
  wave when they cross in the corridor, chat at the pantry with icon-only bubbles and play ping-pong with a moving ball. Real work always wins: anything that needs you cancels it.
- Settings: **Celebrations** (on by default) and the animation level (calm / normal / lively). With reduced motion there are no particles or jumps, only a still badge.

## Codex support
- Open **OpenAI Codex CLI** sessions (`~/.codex`, `CODEX_HOME`, `AI_OFFICE_CODEX_DIRS`) appear next to Claude Code ones: same rooms
  (by folder), same statuses, activities, tasks, tokens, estimated cost, day report, time-lapse, usage cards and progress.
  They are **read-only**: Codex has no hooks, so permissions, messages and hiring are Claude Code only; the UI disables
  those actions for Codex agents and says why.
- A "Codex" badge marks the agents (chip, plus a distinct accent ring and name tag in the worlds) and "Codex" is an account
  filter chip. Settings has **Show Codex sessions** (on by default when a Codex home exists); off, the folder is not read.
- Not supported: answering approvals from the page, messaging or hiring Codex, live "running" state of a command while it
  runs (only on newer CLIs that log the begin), sessions resumed from more than a day-old folder until they are written.

## Personalization
The person makes the office theirs; nothing here changes the sessions or the projects, and everything is local (see [02-server.md](02-server.md#customization-apicustomization), [03-world-2d.md](03-world-2d.md#looks-and-room-finishes), [04-ui.md](04-ui.md#customization) and [06-world-3d.md](06-world-3d.md)).
- **Agents.** Rename an agent (the name shown, per session) and choose its look: skin tone, hair style and color, outfit color, accessory (glasses, headphones, cap or none). Without a choice everything stays drawn from the agent's seed. The same choice is drawn by the 2D sprites and the 3D models. A look can be kept for one agent, for every agent of a room ("the team") or of an account; a subagent wears the defaults its main agent's room and account give unless it has choices of its own. The editor previews the result with the renderer in use.
- **Rooms.** A display alias (the project does not change), a color, a floor (wood, carpet, tiles, concrete), a wall finish (wood slats, plaster, brick, concrete), plant density (few, normal, lush) and a sign style (brass, neon, wood, minimal). Only the room that changed is drawn again, in both worlds.
- **Layout.** Reorder the rooms (drag in **Organizar salas**, which shows the slots of the building, or move up and down), pin favorites to the front and hide a room: a hidden room is not in the building but stays in the sidebar.
- **Persistence.** The server keeps it in `<state dir>/customization.json` and puts it on every snapshot, so every tab and the share card show the same office. Each item can be reset, and **Restaurar tudo** resets everything. The demo ships a few customized agents and rooms.

## Non-goals
Remote multi-user access; editing files; sending prompts to running sessions other than through the message feature (a
first prompt can be given when hiring an agent); Windows-specific work.
