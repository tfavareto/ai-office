# Privacy and security

This guide states exactly what AI Office reads, what it stores, how it keeps everything on your computer, how access is protected and how to report a vulnerability.

The short version: the server reads Claude Code's files read-only, binds to `127.0.0.1`, makes no outbound network requests (the one optional exception is the pull request lookup through your own `gh` CLI, **off by default**, see [Git and pull requests](#git-and-pull-requests)) and refuses requests that do not carry its access token or that come from another site. The one thing it can start is a terminal window running Claude Code, only when you hire an agent (see [Hiring an agent](#hiring-an-agent)).

## What AI Office reads

The server reads files that Claude Code already writes in each account's config directory (for example `~/.claude`). It never writes to them.

| Source | Used for |
| --- | --- |
| `<dir>/sessions/<pid>.json` | Which sessions are open (a session is open while its file exists and its process is alive), its working directory, title and busy or idle state. |
| `<dir>/projects/<project>/<session>.jsonl` | The session transcript: prompts, replies, tool calls and results, token usage and model. Tailed incrementally. At startup only the last 2 MB of each transcript is read; after that, only new lines. |
| `<dir>/projects/<project>/<session>/subagents/agent-<id>.jsonl` and `.meta.json` | Subagent activity, type and description. |

**Codex.** When a Codex home exists (`CODEX_HOME`, `~/.codex`, or a folder of `AI_OFFICE_CODEX_DIRS`) the server also reads, read-only, `<home>/sessions/YYYY/MM/DD/rollout-*.jsonl` (the session records: prompts, replies, commands, patches, token counts, the working directory) and `<home>/session_index.jsonl` (the names Codex gave threads). It **never opens** `auth.json`, `config.toml`, the databases, logs, plugins or any other file in that folder, and it makes no request to OpenAI. Codex rollouts go through the same rules as Claude transcripts: tailed incrementally (2 MB at startup), lines over 6 MB ignored, text capped, the usage index keeps only numbers, nothing is written to disk. **Settings → Show Codex sessions** (or `AI_OFFICE_CODEX=0`) stops the server from reading that folder at all.

Beyond live tailing, three features read more on request:

- **Terminal panel and session history** read a transcript on demand to show the conversation, and scan the last 7 days of transcripts for titles. Entries keep at most 4 KB of text each, a view pages at 500 entries, and the cached view is capped at about 8 MB.
- **Usage cards and the Consumo view** are filled by a background indexer that reads every transcript of this and the previous month (then only what is appended) and keeps only token counts, the model, the message id, the timestamp and the working directory. It never keeps or logs prompts, replies, tool calls or file contents.

- **Git state** of each room: the server runs a few read-only `git` commands in the project folders (see [Git and pull requests](#git-and-pull-requests)). It keeps the branch, the counts of changed files and lines, the last commit's hash, subject and time, and the number of stashed entries in memory and sends them to the page; the day report also reads the day's commit subjects with `git log`. Nothing is written to disk.

- **Day report** (the Report tab of **My day**) reads the part of each transcript that belongs to the chosen day, up to seven days back, on request and in the background. From it the server keeps in memory only counters and short strings: tool call counts, the paths of files edited, the first line of each command (credential-looking values such as `--token x`, `API_KEY=x` and bearer tokens are masked), commit subjects printed by `git commit`, completed task titles, test outcomes, timestamps and, for the optional **Include the requests** switch, the first line of each of your prompts (140 characters). The request texts are only sent to the page when the switch is on, which is off by default. Nothing from the report is written to disk by AI Office, and the Markdown export only happens when you press the buttons. Read the exported file before sharing it: it names your projects, files, commands and commits.

- **Time-lapse** (**Watch the day** in **My day**) reads the same slice of the same transcripts as the day report, through the same reader and cache, and builds a list of moments (arrivals, status changes, what each agent was doing, task lists, commits, test outcomes). It never includes anything said: a prompt becomes the words "New task", replies and error details are dropped, the parameters of an activity (a command, a file, a query) are masked for credentials like the report's commands and cut to 80 characters, and an agent's title is only the title the session itself set. The list is kept in memory, sent only to a page opened on this computer (local-only, token and `Sec-Fetch-Site` checks like the other session endpoints) and never written to disk. While it plays, the page cannot send messages, answer permissions or open terminals.

It does not read your credentials, your Claude Code or Codex settings, your API keys or your project source files. Statistics only cover what it has read: the tail at startup plus everything new.

## What AI Office stores

Only its own state directory (`~/.ai-office` by default, mode 0700):

| File | Content |
| --- | --- |
| `token` | The random access token (mode 0600). |
| `names.json` | The name picked for each agent, keyed by account, session and agent id. |
| `days/YYYY-MM-DD.json` | Per agent, per day, time spent in each status (for **My day**). |
| `usage-index/` | Mode 0700, files 0600. `YYYY-MM.json` shards: per hour, account, project (working directory path), model, session id and subagent id, the counts of input, output, cache-write and cache-read tokens and the estimated cost. `meta.json`: for each transcript, its path relative to the account directory, session and subagent ids, how many bytes were read, its size, modification time, inode, a hash of its first bytes and the ids and counts of the last 16 messages. Numbers and identifiers only: no conversation text. Up to 13 months are kept; delete the folder at any time and it is rebuilt. |
| `progress.json` | The office level and achievements (mode 0600, written atomically): per local day, counters (sessions, work time, tasks completed, commits, passing test runs, tokens, subagents), the agents with most completed tasks that day (name and the project folder's name, never a path), a folded total of older days, the unlock dates and the first time you watched a time-lapse or shared the card. Numbers and names only: no prompt, reply, task title or file content. Delete it and the history is counted again. |
| `git-settings.json` | Whether the pull request lookup is on (`{ "version": 1, "pullRequests": false }`, mode 0600). |
| `rules.json` | Your approval rules and their counters (mode 0600, written atomically). |
| `rules-log.json` | The last 500 automatic decisions of the rules: the command, file or address that was asked (cut to 200 characters, URLs without their query string), the agent and the project (mode 0600). **Clear log** in the rules dialog erases it. |

Messages, permission requests and notifications live in the server's memory and are gone when it stops. The browser stores your interface preferences, including the interface language, in `localStorage` (`ai-office:prefs`). The page also sends the language code in use (`pt-BR`, `en` or `es`) with the messages and permission answers it posts, so the plugin can phrase its output in that language; the code stays on this computer like everything else. No transcript content is written to disk by AI Office.

## Local only

- The server binds to `127.0.0.1` by default. A non-loopback `AI_OFFICE_HOST` is refused at startup unless remote access is explicitly allowed.
- The server and the plugin hooks make **no outbound network requests**, with one optional exception: if you turn on **Settings → Look up pull requests with gh (uses the internet)**, the server starts your own `gh` CLI, which talks to GitHub (see [Git and pull requests](#git-and-pull-requests)). It is off by default. The hooks connect to `127.0.0.1` and nothing else.
- Features that act on sessions (terminal, session history, permissions, messages, attention marks, hiring an agent, the demo switch) are **local-only**: they require a loopback bind, a loopback `Host` header and a loopback peer address. Without all three they answer 403 `local-only`.
- The web app loads all its scripts, styles and assets from the server itself. 3D models and textures are bundled (CC0), not fetched from a CDN.

## Access token

On first start the server creates 32 random bytes, hex encoded, at `<state dir>/token` (file mode 0600, directory mode 0700) and reuses it afterwards. Every `/api/*` route except `GET /api/health` requires it:

| Client | How it presents the token |
| --- | --- |
| Plugin hooks | `Authorization: Bearer <token>`, read from the token file on every run. |
| The web page | An `ai_office_token` cookie: `HttpOnly`, `SameSite=Strict`, `Path=/`. The server sets it only when it serves the page to a loopback peer over a loopback bind. There is no `?token=` bootstrap. |

A missing or wrong token gets 401 `unauthorized`, including for unknown paths. The token is compared in constant time.

`GET /api/health` without a token returns only `{"ok":true}`. With a `challenge` nonce it also returns `proof`, an HMAC-SHA256 of `ai-office/health/v1:<nonce>` keyed with the token. A hook verifies this proof **before** sending the token anywhere, so a stranger squatting on the port never sees the token and can never get a permission auto-approved.

Never share the token or paste it into chats, issues or logs. If it may have leaked, rotate it: stop the server, delete `token`, start the server and reload the page.

## Request guards

Every request passes through a guard before any handler runs:

| Check | Rejects with |
| --- | --- |
| `Host` header must be a loopback name (or the bind address, or an IP literal for a wildcard bind) and carry the right port. Protects against DNS rebinding. | 403 `host-not-allowed` |
| `Sec-Fetch-Site`, when sent, must be `same-origin` or `none`. | 403 `cross-site` |
| Only `GET`, `HEAD`, `POST`, `PATCH` and `DELETE` are served. | 405 |
| `POST` and `PATCH` must be `application/json`. | 415 |
| `POST`, `PATCH` and `DELETE` `Origin`, when present, must be the page's own origin (hooks send none). | 403 `origin-not-allowed` |
| Request bodies are limited to 256 KB. | 413 |

Limits: a request must arrive within 30 seconds and its headers within 15 seconds (this does not apply to long-lived responses), at most 20 simultaneous live streams (more get 503 `too-many-streams`), and long-poll waits are capped at 25 seconds per request.

Every response, static or API, carries:

```text
Content-Security-Policy: default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; worker-src 'self' blob:; connect-src 'self'; frame-ancestors 'none'
X-Frame-Options: DENY
X-Content-Type-Options: nosniff
Referrer-Policy: no-referrer
```

The page cannot be framed, cannot load scripts from other origins and cannot connect anywhere but its own server. The UI builds text with `textContent`, never `innerHTML` with session data.

## Approval rules

[Approval rules](02-using-the-office.md#approval-rules) let AI Office answer permission requests without you, so they are the one place where a mistake would approve something you did not see. The safety rules are enforced by the server and shared with the page, and covered by tests:

- **Dangerous requests are never approved by a rule.** Recursive deletes, `sudo`, forced pushes, hard resets, recursive permission changes, piping a download into a shell, disk and database wipes, writes to secrets and system files, and code run inline (`bash -c`, `node -e`, `python -c`) always go to you, even when an allow rule matches. The log records that the rule matched and why you were asked. A deny rule can still refuse them.
- **Allow rules cannot be broad by accident.** Saving an allow rule is refused, with an explanation, when it would also cover a dangerous request: `any` on Bash or on file tools, `mcp__*`, prefixes such as `rm`, `sudo`, `git` or `git push`, shells, `env`, `xargs`, globs at the root, in system folders or on secrets, and hosts such as `*.com`. Rules found in `rules.json` that fail this policy are loaded switched off.
- **Only simple commands.** An allow rule matches a command only when it is a single command: anything with `;`, `&&`, `||`, `|`, `&`, a backtick, `$(`, a redirection, parentheses or a line break (even inside quotes) never matches, so `npm test; rm -rf /` is not covered by `npm test`. Prefixes match whole words (`npm testx` is not `npm test`). Deny rules, in contrast, look inside compound commands and through `sudo`/`env`.
- **Paths are judged as asked.** Globs never match dot files (`.env`, `.ssh`, `.git`), `..` cannot escape a folder, and symbolic links are not followed.
- **Deny wins.** A matching deny rule beats any allow rule; disabled rules do nothing.
- **Local, authenticated, validated.** The `/api/rules` endpoints are local-only, need the token, pass the request guards above and validate every field (sizes, types, at most 200 rules); the files are written atomically with mode 0600, and a file that cannot be read is moved aside, never overwritten.
- **Visible.** Every automatic decision is logged, shows as a quiet line in the agent's activity, and counts as a hit on the rule.

## Git and pull requests

**Repository state (always on, local).** For each room whose folder has a `.git`, the server runs read-only `git` commands (`status`, `diff --shortstat`, `log`, `stash list`) with an argument array, no shell, the project folder as working directory and a 3 second limit, at most two at a time. They run with `--no-optional-locks` (so they never block your own git commands), `core.fsmonitor` off and no external diff or text-conversion programs, an environment reduced to `PATH`, `HOME` and a few locale variables plus `GIT_TERMINAL_PROMPT=0` (no prompt, no credentials), and they never fetch, never write and never run hooks. A room is read when it appears, every 30 seconds while its agents work and every 5 minutes otherwise, and shortly after an agent finishes a tool call. Without `git` installed, or for folders that are not repositories, nothing is shown. This part makes no network request.

**Pull requests and CI (off by default, uses the internet).** The pull request and check status of a branch can only come from GitHub, so this is the **only** feature of AI Office that contacts the internet, and it never does so by itself: it works only when you turn on **Settings → Look up pull requests with gh (uses the internet)** (a local-only, token-protected setting stored in `git-settings.json`), and only through the `gh` CLI that you installed and signed in. For each room with a branch the server runs `gh pr view --json number,title,state,url,isDraft,reviewDecision,statusCheckRollup` in the project folder every two minutes (and when the branch changes), with an argument array, no shell and a 15 second limit, in your own environment (so `gh` uses its own credentials; AI Office never reads, stores or sends them). What GitHub answers is validated; only the pull request number, title, state, review decision, the check counts and failing check names, and an http(s) link are kept, in memory, and shown in the page. The link opens GitHub in your browser only when you click it. Turn the switch off and the lookups stop at once. If `gh` is missing or not signed in, AI Office says so in Settings and tries again at most every ten minutes.

## The share card

The picture and caption of **My day → Share** are made in your browser from the day report numbers and a throwaway copy of the office; nothing is uploaded, and AI Office does not post anywhere (you download or copy the image yourself). By default the card holds counts and totals only: it draws no project names (rooms are "Room 1", "Room 2"…), agent titles, task texts, branches, file paths, commands or prompts, and the day report it uses is requested without the user's requests. **Show project names** adds the project names to the room signs and the highlight; **Show cost and tokens** adds the estimated cost and tokens of the day; both are off every time the dialog opens. Look at the picture before you post it: the card follows these rules, but it cannot know what is private to you.

## The office that grows

Levels, achievements and the "Employee of the month" are computed on your computer from the same transcripts and usage index as the day report, and nothing is sent anywhere. `GET /api/progress` and `POST /api/progress/event` are local-only, token-protected and origin-guarded like the report. The snapshot carries the level and, for the plaque, the **agent's name only**; the project name leaves the server only when the page asks for it (`?project=1`) because you turned on **Show the project in Employee of the month**, and it is the folder's name, not a path. The share card draws the decoration of your level but never the employee's name. Demo mode has its own fixed progress and never touches the real one. **Settings → Office evolution** hides everything visible about it.

## Hiring an agent

`POST /api/agents/hire` is the only endpoint that starts a program. What it can launch is fixed:

- **Which program.** A terminal window (`osascript` for Terminal.app or iTerm2 on macOS; `x-terminal-emulator`, `gnome-terminal`, `konsole`, `xfce4-terminal` or `xterm` on Linux) that runs `/bin/sh` on a launcher script the server wrote, which runs the `claude` executable the server found itself (an absolute `PATH` entry, `~/.local/bin/claude` or `~/.claude/local/claude`). The request cannot name an executable, arguments or environment variables: it carries only a folder, an account id, a prompt, a model alias, a permission mode, a desk number and a language, each validated (absolute existing readable folder, a known account, enums, size limits: prompt 8000 characters, path 1024). Unknown fields are ignored. Permission modes that skip checks (`bypassPermissions`, `dontAsk`) cannot be chosen from the office.
- **No shell injection.** The folder, the prompt and the account directory only appear in the launcher script, written with single-quote quoting (tested against quotes, spaces, newlines, `$()`, backticks, unicode and leading dashes by running the script with a stub `claude`); the terminal is only ever told to run `/bin/sh '<script path>'` and the programs are started with argument arrays, never through a shell. The prompt is one argument.
- **Where the prompt goes.** The launcher lives in a fresh private directory (mode 0700, file 0600) under the system temp dir and deletes itself and its directory the moment it starts (a launcher nobody ran is removed after 10 minutes). The prompt then lives in the Claude Code session like any other prompt.
- **Guards.** Local-only (loopback bind, `Host` and peer), the access token, `Sec-Fetch-Site`, JSON-only and same-origin `POST`, a 256 KB body limit and **5 launches per minute**; the folder check endpoint has its own limit (120 per minute) and only tells whether a directory exists and can be entered.
- **Demo mode.** Nothing is launched: hires into non-real rooms are simulated.

If you do not want this at all, do not open the page on the computer that runs AI Office: the endpoint answers 403 `local-only` to every other client. A macOS prompt asks once whether the app that runs the server may control Terminal.

## Remote access

Remote access is **not supported for browsers**. The setting exists only for programmatic `Bearer` clients:

- `AI_OFFICE_HOST` set to a non-loopback address (for example `0.0.0.0`) is refused at startup unless `AI_OFFICE_ALLOW_REMOTE=1` (or `--allow-remote`) is also set.
- Even with it, the server issues no cookie to non-loopback peers, offers no token in the URL, and keeps all local-only features off. A remote browser sees a page that cannot authenticate.
- With a wildcard bind, only IP-literal `Host` values are accepted, never arbitrary names.

Exposing the server to a network is your responsibility. If you want to see the office from another device, there is no supported way today.

## Cost figures are estimates

Costs shown in the usage cards, the **Consumo** view and the **Custo** tile are computed locally from public list prices per model family and token counts. They ignore plan discounts, subscriptions and anything your account is actually billed. Token counts exclude cache reads. Treat them as a rough guide, not an invoice. The limit forecast in **Consumo** is a projection of your recent pace against a limit you typed in (or your highest recent block): Claude's real plan limits are not visible on this computer.

## Reporting a vulnerability

Do not open a public issue. Follow [SECURITY.md](../SECURITY.md): report privately through GitHub Security Advisories, with the affected component, steps to reproduce and your environment, and redact tokens, personal paths and session content from any logs.

## Next

- [Plugin](03-plugin.md): how the hooks authenticate.
- [Configuration](04-configuration.md): host, port and state directory settings.
- [Architecture](07-architecture.md)
- [Architecture spec, Security section](spec/01-architecture.md)
