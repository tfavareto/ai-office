# AI Office — product spec

AI Office is a local web app that turns the Claude Code sessions running on this computer into a live corporate
office. Every open project is a room; every session is a person working in it; subagents are colleagues who arrive,
work and leave. The user watches what each agent is doing in real time, answers permission requests, sends messages
("ordens") to agents and reviews the day.

Audience: developers using Claude Code (CLI or desktop) on macOS/Linux, often with more than one account. UI language:
**Brazilian Portuguese** (all visible text). Code, comments and docs in the repo: English.

## Principles
- **Local and private.** The server reads Claude Code files on this machine and binds to 127.0.0.1 by default. Nothing
  leaves the computer. Features that act on sessions (terminal view, permissions, messages) only work when the page is
  opened locally (Host is localhost/127.0.0.1).
- **Never break Claude Code.** Hooks exit fast and silently when AI Office is not running; they never block a session.
- **Smooth.** 60 fps target in the default (2D) view on a MacBook; no main-thread stalls over 100 ms after load. 3D is
  an optional visual.
- **Delightful.** Premium corporate look (warm walnut, marble, brass, glass, plants), lively but calm characters,
  readable at a glance.

## Feature list (all required for 1.0)
1. **Office view (2D default, 3D optional)**: building with core areas (Recepção, Copa, Sala de reunião, Banheiros,
   Lounge) and one room per open project; people walk, sit at desks, gather, react to status. Day/night cycle by local
   time (auto/day/night setting). Click a person or room to open details; double-click focuses camera. Pan (drag/WASD/
   arrows), zoom (wheel/+/-), "visão geral" (O).
2. **Top bar**: brand "AI Office" (logo + wordmark), connection pill, counters (salas, agentes, trabalhando,
   subagentes, shells rodando, precisam de você; the last two clickable to jump to the next one), usage cards per
   account (tokens and estimated cost: 5h window, week, today), buttons: visão geral, zoom, notifications (bell with
   unread badge), Meu dia, histórico de sessões, feed, configurações, ajuda.
3. **Sidebar**: search (agent, project, account; "/" focuses), account filter chips, list of rooms with their agents
   and subagents (avatar, name, account chip, role, current activity, status dot, elapsed time for long shells), room
   task progress.
4. **Details drawer** (agent): hero (avatar, name, role, account, room link), title, status row (status + since,
   actions: Mensagem, Seguir, Centralizar, Terminal), urgent cards always on top (permission request card with
   Aprovar / Aprovar e não perguntar de novo / Recusar (reason, interrupt) / Responder no terminal; "Precisa de você"
   alert; "Esperando o shell" card), then tabs: **Resumo** (KPI tiles in a 2x2 grid: ferramentas, tokens, tempo na
   sessão, custo; Agora; Tarefas; Subagentes/Responsável), **Mensagens** (composer + history), **Atividade** (running
   shells, timeline), **Dados** (stats list, model, branch, permission mode, session id copy, start, duration). Room
   drawer: hero (color, name, path copy), accounts, agents list, team message composer, tasks, recent activity.
5. **Feed**: collapsible bottom panel with the latest activities of the whole office.
6. **Toasts + notification center**: toasts for notices (alerts persist until resolved; dedupe repeats); bell popover
   with history, filters (Tudo / Precisa de você / Mensagens), unread badge, "Não perturbe" (only alerts toast/sound),
   clear. Optional browser notifications for alerts when the tab is hidden. Tab title shows "(n) AI Office" when n
   agents need the user.
7. **Messages to agents**: composer with quick chips ("Como está indo? Me dê um resumo rápido.", "Pare e me explique o
   plano antes de seguir.", "Rode os testes antes de continuar.", "Pode finalizar e me mandar um resumo."), Cmd/Ctrl+
   Enter sends, status per message (Na fila / Entregue durante o trabalho / Entregue como nova instrução / Expirou),
   team message to all agents of a room (grouped history "2 de 3 entregues"), key N opens it. Delivery via plugin hooks
   (PostToolUse adds additionalContext; Stop blocks with the message as reason; Stop waits up to 10 min "de plantão"
   when a page is open).
8. **Permission answers**: the plugin's PermissionRequest hook sends requests; the page shows them (P jumps to next);
   the terminal dialog still works (first answer wins).
9. **Read-only terminal**: panel that renders a session's conversation like the terminal (user prompts, assistant
   text, collapsed thinking, tool calls with summaries and results), live-updating, search (Ctrl/Cmd+F). T toggles for
   the selected agent. Session history popover: sessions of the last 7 days grouped by day, searchable; opens closed
   sessions read-only.
10. **Meu dia**: dialog with time per status per agent today (bar per agent + totals), from the server's day recorder.
11. **Settings**: visual (2D/3D; applies immediately), dia e noite (auto/dia/noite), nomes sobre as pessoas, balões
    (todos/importantes/nenhum), animação (calma/normal/animada), sons (on/off + volume), notificações do navegador,
    modo demonstração (fake agents), sobre (version).
12. **Help**: legend (statuses, icons), shortcuts, how to install the plugin.
13. **Demo mode**: fake sessions that behave realistically (screenshots, first run with no sessions). `?mock=1` runs a
    fully client-side simulation without a server.
14. **Claude Code plugin**: one plugin "ai-office" (marketplace in this repo) with hooks: PermissionRequest (answer from
    the office), PostToolUse + Stop + SubagentStop (deliver messages), Notification (mark "needs you").
    `npm run plugin:install|uninstall|status` installs into every detected account via the `claude plugin` CLI.

Keyboard: / search, F follow selected, T terminal, N message, P next permission, M meu dia, O overview, [ sidebar,
] feed, ? help, Esc closes the topmost thing (terminal search, terminal, drawer/selection).

## Non-goals
Remote multi-user access; editing files; sending prompts other than through the message feature; Windows-specific work.
