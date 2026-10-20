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
   collapse into a "+N" button that opens a popover with all of them), buttons: overview, zoom, notifications (bell with
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
10. **My day**: dialog with time per status per agent today (bar per agent + totals), from the server's day recorder.
11. **Settings**: language (Automatic (system) / English / Português (Brasil) / Español; switches live, keeping
    selection, panels and camera; "Automatic" resolves from the browser languages: pt → Português, es → Español,
    otherwise English), visual (2D/3D; applies immediately), day and night (automatic/day/night), names above people,
    bubbles (all/important/none), animation (calm/normal/lively), sounds (on/off + volume), browser notifications,
    demo mode (fake agents), about (version). Preferences live in the browser.
12. **Help**: legend (statuses, icons), shortcuts, how to install the plugin.
13. **Demo mode**: fake sessions that behave realistically (screenshots, first run with no sessions). `?mock=1` runs a
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

Keyboard: / search, F follow selected, T terminal, N message, P next permission, I inbox (inside it: J/K or arrows move,
Space select, A approve, Shift+A approve and remember, D deny, Enter open, E mark seen), M my day, K task board (on a focused card: M moves it), O overview,
H hire an agent, [ sidebar, ] feed, ? help, Esc closes the topmost thing (terminal search, terminal, drawer/selection).

## Non-goals
Remote multi-user access; editing files; sending prompts to running sessions other than through the message feature (a
first prompt can be given when hiring an agent); Windows-specific work.
