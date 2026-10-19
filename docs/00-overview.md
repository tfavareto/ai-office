# Overview

This guide explains what AI Office is, the mental model behind the office metaphor, how each status is derived and what the project deliberately does not do.

## What AI Office is

AI Office is a local web app that turns the Claude Code sessions running on your computer into a corporate office you can watch in real time. A small Node.js server reads the files Claude Code already writes under `~/.claude`, works out what every session is doing and streams that to a page in your browser. An optional Claude Code plugin adds two-way features: you can answer permission requests and send messages to agents from the office.

The interface is available in English, Portuguese (Brazil) and Spanish, and follows your browser's language unless you pick one in **Settings → Language** (see [using the office](02-using-the-office.md#language)). This documentation is in English and quotes the English labels, for example **Needs you**. Text that comes from your own sessions (prompts, task titles, commands, file names) is shown as written, whatever language the interface is in.

## The mental model

| In Claude Code | In the office | Notes |
| --- | --- | --- |
| A project (working directory) with an open session | A **room** | One room per open project. The building grows and shrinks as projects open and close. |
| A session | A **person** at a desk | Named from a fixed list of Brazilian first names, chosen by hashing the account and session so the name stays stable. |
| A subagent (`Agent` or `Task` tool) | A **colleague** who works at the meeting table | Arrives when the work starts, leaves shortly after it finishes. Shown with a badge. |
| A background command or monitor | A **shell**: the person leans back and watches the screen | Counted in the top bar as **shells running**. |
| A Claude config directory (`~/.claude`, `~/.claude-work`, ...) | An **account** | Shown as a colored chip. Several accounts can share one office. |

The building has fixed common areas (**Reception**, **Pantry**, **Meeting room**, **Restrooms**, **Lounge**) plus one room per project. People arrive and leave through the reception elevators. When nothing needs doing, idle people walk to the pantry or the lounge. The signs and labels inside the office follow the interface language too.

## Statuses

Every person has one status. The server derives it from the session registry and the transcript, then the page refines it for display.

| Label in the UI | Meaning | How it is derived |
| --- | --- | --- |
| **Working** | A turn is in progress: reading, editing, thinking. | The transcript shows a turn in progress or a tool call pending, or the session registry says `busy`. A turn that stopped producing events for 15 seconds while the registry says `idle` counts as finished. |
| **Needs you** | Stopped until you approve, answer or decide. | Any of: a permission request is pending in the office; the plugin's `Notification` hook flagged the agent; an `AskUserQuestion` or `ExitPlanMode` call is pending; the registry says `waiting`; or a tool call has been pending for more than 8 seconds while the registry says `idle` (shown as "Approve" plus the tool name). |
| **Waiting for the shell** | A shell command is still running. | The agent has a running foreground command (or a background one while idle). A `Bash` call becomes a shell job when it is started in the background or runs for more than 10 seconds without a result. |
| **Idle** | The turn ended; the session stays open. | The turn finished and nothing else applies. |
| **Done** | A subagent finished and is leaving. | The spawning `Agent`/`Task` call returned, a task notification arrived, the subagent ended its own turn, or it had no events for 2 minutes. It leaves 6 seconds later. |
| **Error** | The last action ended with an error. | An idle agent whose latest activity was a tool error. |
| **Offline** | The session closed; the person is leaving. | The registry file is gone or its process is no longer alive. |

The priority is: needs you, then working, then idle. Shells and errors are refinements of working and idle that the page applies on top.

Where the registry (`<config dir>/sessions/<pid>.json`) is missing for an account, the server falls back to transcripts modified in the last 30 minutes and cannot tell `busy` from `idle` as precisely.

## Principles

- **Local and private.** The server binds to `127.0.0.1` by default and makes no outbound network requests. Features that act on sessions (terminal view, permissions, messages) only work when the page is opened on this computer. See [privacy and security](05-privacy-and-security.md).
- **Never break Claude Code.** The plugin hooks exit silently and quickly when AI Office is not running. They cannot block or fail a session. See [plugin](03-plugin.md).
- **Smooth.** The default 2D view is built to stay at 60 frames per second on a laptop. 3D is an optional visual and costs more. See [evidence and limits](06-validation.md).
- **Read-only toward Claude Code.** AI Office reads Claude Code's files and never writes to them. The only things it writes are its own files in the state directory.
- **2D by default, 3D when you want it.** Both views show the same office with the same behavior; only the rendering differs. See [using the office](02-using-the-office.md#2d-and-3d).

## What it is not

- Not a remote or multi-user dashboard. Browsers cannot sign in from another machine.
- Not an editor and not a way to run arbitrary commands. The only way to talk to an agent is the message feature, which delivers text through the plugin's hooks.
- Not a billing tool. Costs are estimates computed from public list prices.
- Not for Windows. macOS and Linux are the supported platforms.

## Next

- [Install it](01-installation.md) or paste [prompt 01](prompts/01-install-and-run.md).
- [Tour the interface](02-using-the-office.md).
- [Product spec](spec/00-product.md) for the original feature list.
