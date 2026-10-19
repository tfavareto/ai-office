# Using the office

This guide tours the screen: the top bar, the sidebar, the office itself, the details drawer, notifications, **Meu dia**, the terminal panel, settings, the statuses legend, keyboard shortcuts and the 2D and 3D views.

The interface is in Brazilian Portuguese. Labels are quoted with their English meaning. Some features act on your sessions (permission answers, messages, terminal, session history, demo switch); they only work when the page is opened on the same computer as the server (`localhost` or `127.0.0.1`). Otherwise they show "Disponível apenas quando o AI Office é aberto neste computador (localhost)."

## The screen

Dark glass panels float over the office:

- Top bar (full width)
- Sidebar on the left (collapsible with `[`)
- Details drawer on the right (opens when you select something)
- **Atividade** (activity) feed along the bottom (collapsible with `]`)
- Toasts bottom right

On screens narrower than 900 px the sidebar and drawer become overlays.

When no session is open, a card says **Nenhuma sessão aberta** (no open session) with the steps to start one and a **Ver em modo demonstração** (see in demo mode) button.

## Top bar

| Element | What it does |
| --- | --- |
| Sidebar button | Show or hide the sidebar (`[`). |
| Logo and "AI Office" | Brand. |
| Connection pill | **Ao vivo** (live), **Ao vivo · demo**, **Reconectando…** (reconnecting; the page retries with a growing delay up to 30 s), **Conectando…** (connecting), or **Demonstração local** when you opened `?mock=1`. |
| Counters | **salas** (rooms), **agentes** (agents), **trabalhando** (working), **subagentes** (subagents), **shells rodando** (shells running), **precisam de você** (need you). The last two are buttons that jump to the next shell or the next agent that needs you. They are disabled at zero. |
| Usage cards | One per account: tokens and estimated cost for the **5 h** window and the **Semana** (week). Hover for the tooltip, which adds **Hoje** (today) and when each window resets. Costs are estimates from public list prices. |
| Visão geral (O), Afastar (-), Aproximar (+) | Fit the whole office, zoom out, zoom in. |
| Camera button | 3D only. Cycles **Visão geral**, **Primeira pessoa** (first person) and **Sobre o ombro** (over the shoulder). |
| Bell | **Notificações** with an unread badge. |
| Calendar | **Meu dia** (M). |
| History | **Histórico de sessões** (session history). |
| Feed | **Atividade** (`]`). |
| Gear | **Configurações** (settings). |
| Question mark | **Ajuda** (help, `?`). |

The browser tab title shows **(n) AI Office** while *n* agents need you.

## Sidebar

- **Search** (`/` focuses it): filters agents, projects and accounts. Arrow keys move through results; `Esc` clears the search.
- **Account chips**: filter the list by account when you have more than one.
- **Rooms** list: each room can be collapsed and shows how many of its agents need you. Click a room to select it and move the camera there.
- **Agent rows**: avatar with a status dot, name, account chip, role, current activity and how long ago the status changed. For an agent waiting on a shell, the time is the shell's elapsed time. Subagents are indented under their parent. Click selects and focuses; people who are leaving fade out.

## The office

| Gesture | Effect |
| --- | --- |
| Hover a person or room | A small tip: for a person, the name, role, status and current activity; for a room, the project name, how many people are in it and its path. |
| Click a person or room | Select it and open the drawer. |
| Double-click | Focus the camera on it. |
| Drag, `W` `A` `S` `D`, arrow keys | Pan. Hold `Shift` to pan faster. |
| Mouse wheel, `+`, `-` | Zoom. 2D zooms in whole steps to keep the pixel art sharp. |
| `O` | **Visão geral**: fit the whole office. |
| `F` | **Seguir** (follow): keep the camera on the selected agent. |

People react to their status. **Trabalhando** people sit and type at their desk; subagents work at the meeting table. **Precisa de você** people stand with a raised hand and a bubble reading "Precisa de você". Idle people walk to the café or the lounge and chat. People waiting for a shell lean back and watch their screen. Finished or offline people walk to the elevator and leave. Speech bubbles show what an agent is doing; you can limit them in settings.

## Details drawer: an agent

Select a person to open the drawer.

**Header.** Avatar, name, kind (**Principal** or the subagent's role), account chip and a link to the room. Below it, the session title, the current status with how long ago it began, and four actions:

| Action | Effect |
| --- | --- |
| **Mensagem** (message) | Opens the **Mensagens** tab with the composer focused (`N`). |
| **Seguir** (follow) | Camera follows the agent (`F`). |
| **Centralizar** (center) | Moves the camera to the agent once. |
| **Terminal** | Opens the read-only terminal panel (`T`). |

**Urgent cards** always sit at the top:

- **Pedido de permissão** (permission request): the tool, a one-line summary, **Ver detalhes** (the tool input) and a countdown ("expira em"). Buttons: **Aprovar** (approve); **Aprovar e não perguntar de novo** (approve and do not ask again), one per rule Claude Code suggested, which also saves that rule; **Recusar** (refuse), which reveals an optional reason the agent will read and a checkbox **Interromper o turno do agente** (interrupt the agent's turn), confirmed with **Confirmar recusa**; and **Responder no terminal** (answer in the terminal), which hands the decision back to the terminal dialog. The first answer wins, whether it comes from the office or the terminal.
- **Precisa de você**: shown when the agent waits on something the office cannot answer (a question or plan approval, or a notification). Its button opens the terminal panel; you answer in the terminal where the session runs.
- **Esperando o shell**: lists running commands with elapsed time and a stage (**Iniciando**, **Rodando**, **Demorando**, **Execução longa**) that advances at 5 s, 1 min and 5 min.

**Tabs** (arrow keys switch between them):

| Tab | Content |
| --- | --- |
| **Resumo** (summary) | Tiles for **Ferramentas** (tools), **Tokens**, **Tempo na sessão** (session time) and **Custo** (estimated cost); **Agora** (now, the current activity); **Tarefas** (the agent's task list with progress); **Subagentes** (for a main agent) or **Responsável** (the owner, for a subagent). |
| **Mensagens** (messages) | **Enviar ordem** (send an order) composer with quick chips, and the **Histórico** of messages with their delivery status. |
| **Atividade** (activity) | Running shells and a timeline of recent activities. |
| **Dados** (data) | Account, room, kind, model, branch, permission mode, session id (copyable), start, duration, tools, input and output tokens, changed lines, subagents created, estimated cost. |

### Sending messages

The composer takes up to 4000 characters. Four quick chips insert common instructions ("Como está indo? Me dê um resumo rápido.", "Pare e me explique o plano antes de seguir.", "Rode os testes antes de continuar.", "Pode finalizar e me mandar um resumo."). Send with **Enviar** or `Cmd+Enter` / `Ctrl+Enter`. Each message shows a status:

| Status | Meaning |
| --- | --- |
| **Na fila** (queued) | Waiting for the agent's next hook. |
| **Entregue durante o trabalho** (delivered while working) | Added to the agent's context after a tool call. |
| **Entregue como nova instrução** (delivered as a new instruction) | Delivered when the agent finished its turn; it continues with the message as its next instruction. |
| **Expirou** (expired) | Not picked up within 2 hours. |

Messages need the [plugin](03-plugin.md#messages-to-agents). A message to an agent that has left the office is not accepted.

## Details drawer: a room

Select a room (click it, or its row in the sidebar). The drawer shows the room color and project name (with a button to copy the path), counts for agents, working and needing you, the **Contas** (accounts) present, the **Agentes** list, a team composer (**Enviar à equipe**, send to team), **Tarefas** from every agent's plan and **Atividade recente**. A team message goes to every agent in the room (up to 24) and its history reads like "2 de 3 entregues" (2 of 3 delivered).

## Feed

The **Atividade** bar at the bottom shows the count and the latest event. Expand it (`]`) for the stream of activities across the whole office. Each line is the agent, an icon and a short description, for example reading a file, editing, running a command or delegating to a subagent.

## Notifications and Não perturbe

Notices appear as toasts. Alerts (**Precisa de você**) stay until resolved; repeats within two minutes collapse into one with a count. The bell opens the history with filters **Tudo** (all), **Precisa de você** and **Mensagens**, a **Limpar** (clear) button and the **Não perturbe** (do not disturb) switch. With **Não perturbe** on, only alerts produce a toast, a sound or a browser notification; the rest still land in the bell.

Sounds and browser notifications are set in **Configurações**. Browser notifications fire for alerts when the tab is hidden and need your browser's permission.

## Meu dia

**Meu dia** (my day, `M`) shows how long each agent spent in each status today as a bar per agent, with totals for **Trabalhando**, **Esperando você** (waiting for you) and **Ocioso**. The arrows move to other days. The server records this every 5 seconds into its state directory, so it covers the time AI Office was running. Demo agents are excluded.

## Session history

**Histórico de sessões** lists sessions from the last 7 days, grouped by day, searchable by project or title. Opening one shows its conversation in the terminal panel, read-only, even if the session has closed.

## Terminal panel

The terminal panel renders a session's conversation the way the terminal would: your prompts, the assistant's text, collapsed **Pensando…** (thinking) blocks, and tool calls with a summary and result. It updates live (**Ao vivo · somente leitura**, live and read-only) and cannot send input.

| Control | Effect |
| --- | --- |
| `T` | Open or close it for the selected agent. |
| `Cmd+F` / `Ctrl+F` | Search the conversation (only while the panel is open). `Enter` and `Shift+Enter` step through results. |
| Expand button | Expand all thinking blocks and results. |
| **Ir para o fim** (go to end) | Jump to the latest entry. |
| `Esc` | Closes the search first, then the panel. |

Text in the terminal view is truncated (entries keep at most 4 KB of text) and served only to pages opened on this computer.

## Configurações

The settings popover. Everything except the demo switch is stored in your browser (`localStorage`, key `ai-office:prefs`), not on the server.

| Setting | Options |
| --- | --- |
| **Visual** | **2D** (default) or **3D**. Applies immediately. |
| **Dia e noite** (day and night) | **Automático** (follows local time), **Dia** (day), **Noite** (night). |
| **Nomes sobre as pessoas** | Show or hide name tags. |
| **Balões** (speech bubbles) | **Todos** (all), **Importantes** (important, the default), **Nenhum** (none). |
| **Animação** | **Calma** (calm), **Normal**, **Animada** (lively). Sets how fast people walk and how many speech bubbles a room may show at once. If your system asks for reduced motion, the office also stops pulsing and idle wandering. |
| **Sons** | On or off, with a volume slider. |
| **Notificações do navegador** | Browser notifications for alerts (asks for permission). |
| **Modo demonstração** | Fictitious agents alongside real ones. Needs a local page and a live server. |
| **Sobre** (about) | Version and build. |

## Ajuda

**Ajuda** (`?`) shows the status legend, the icon legend, the shortcuts and the plugin install command, with a copy button.

## Statuses legend

| Dot label | Meaning |
| --- | --- |
| **Trabalhando** | Processing a turn: reading, editing or thinking. |
| **Precisa de você** | Stopped until you approve, answer or decide something. |
| **Esperando o shell** | A shell command is still running. |
| **Ocioso** | Turn finished; the session stays open. |
| **Concluído** | A subagent finished and is leaving. |
| **Com erro** | The last action ended with an error. |
| **Offline** | The session closed and the person is leaving. |

Color is never the only signal: every status also has text. How each status is derived is explained in the [overview](00-overview.md#statuses).

## Keyboard shortcuts

Plain keys are ignored while you type in a field.

| Key | Action |
| --- | --- |
| `/` | Search agent, project or account. |
| `F` | Follow the selected agent. |
| `T` | Open or close the selected agent's terminal. |
| `N` | Send a message to the agent, or to the room's team. |
| `P` | Go to the next permission request. |
| `M` | Open **Meu dia**. |
| `O` | Overview of the whole office. |
| `[` | Show or hide the sidebar. |
| `]` | Expand or collapse the activity feed. |
| `?` | Open help. |
| `Cmd+Enter` / `Ctrl+Enter` | Send the message you are writing. |
| `Cmd+F` / `Ctrl+F` | Search inside the terminal (only while it is open). |
| `Esc` | Close the topmost thing: terminal search, terminal, panels, selection. |
| `W` `A` `S` `D` / arrows, `Shift` | Pan the camera; `Shift` is faster. |
| `+` / `-` | Zoom. |

In the 3D first-person camera, `W` `A` `S` `D` walk, dragging looks around, `E` opens the person in sight, `M` toggles a minimap and `Esc` leaves the mode.

## 2D and 3D

Both views show the same office: the same floor plan, the same people and the same behavior. Only the rendering differs.

| | 2D (default) | 3D (optional) |
| --- | --- | --- |
| Look | Pixel art, three-quarter top-down view | A glass tower interior in an isometric view, with a city around it |
| Cost | Very light | Heavier, mainly at night (see [evidence and limits](06-validation.md#frame-rate-measurements)) |
| Zoom | Whole steps | Continuous |
| Cameras | Overview only | **Visão geral**, **Primeira pessoa**, **Sobre o ombro** |
| Loading | Immediate | The 3D code and models are loaded the first time you switch to 3D |

**To switch**, open **Configurações** and pick **3D** under **Visual**. It applies immediately and is remembered in your browser. If the page feels slow in 3D, switch back to 2D.

**Day and night.** **Automático** follows your local time. At night the outside darkens, windows glow and rooms with people are lit. In 3D the night view adds a bloom effect, which is the most expensive part of the scene.

**3D cameras.** Use the camera button in the top bar:

- **Visão geral**: isometric overview. Drag to pan, wheel to zoom.
- **Primeira pessoa**: walk through the office. Drag to look, `E` to open the person you are looking at, `M` for the minimap, `Esc` to leave.
- **Sobre o ombro**: follows the selected agent (or the first visible person if none is selected). Drag to rotate, wheel to change the distance, `Esc` to leave.

3D assets (furniture, plants, textures, city, people models) are CC0; see `packages/web/public/assets/3d/CREDITS.md`.

## Next

- [The plugin](03-plugin.md): permission answers, message delivery, stand-by.
- [Configuration](04-configuration.md)
- [Troubleshooting](08-troubleshooting.md)
- [UI spec](spec/04-ui.md), [2D world spec](spec/03-world-2d.md), [3D world spec](spec/06-world-3d.md)
