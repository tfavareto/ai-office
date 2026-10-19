# AI Office documentation

Guides and copy-paste prompts for installing, using, configuring and contributing to AI Office, a local web app that shows the Claude Code sessions on your computer as a live office.

**Start here:** new to the project? Read the [overview](00-overview.md), then follow the [installation guide](01-installation.md) or paste [prompt 01](prompts/01-install-and-run.md) into an agent and let it do the setup.

## Guides

| Guide | What it covers |
| --- | --- |
| [00 · Overview](00-overview.md) | What AI Office is, the mental model (projects, sessions, subagents), statuses, principles and non-goals |
| [01 · Installation](01-installation.md) | Requirements, install from source, plugin, demo mode, update, run at login, uninstall |
| [02 · Using the office](02-using-the-office.md) | A tour of the screen, the statuses legend, keyboard shortcuts, 2D versus 3D |
| [03 · Plugin](03-plugin.md) | The Claude Code plugin: hooks, permission answers, message delivery, notifications, accounts |
| [04 · Configuration](04-configuration.md) | Every environment variable and flag, hook settings, state directory, demo and dev modes |
| [05 · Privacy and security](05-privacy-and-security.md) | What is read and stored, local-only guards, token and cookie, headers, remote access |
| [06 · Evidence and limits](06-validation.md) | Checks and tests, frame-rate measurements with their method, known limits |
| [07 · Architecture](07-architecture.md) | Packages, data flow and design choices, with links to the specs |
| [08 · Troubleshooting](08-troubleshooting.md) | Symptom, cause and fix tables |

## Prompts

Paste a prompt into Claude Code, Codex or any agent with terminal access. Each one states what the agent may do and asks before anything destructive. The [prompt catalog](prompts/README.md) explains how to use them.

| Prompt | Purpose |
| --- | --- |
| [01 · Install and run](prompts/01-install-and-run.md) | Clone, build, start the server, install the plugin, open the office |
| [02 · Run at login](prompts/02-run-at-login.md) | Start AI Office automatically (launchd on macOS, systemd user service on Linux) |
| [03 · Update](prompts/03-update.md) | Pull, rebuild, restart and refresh the plugin |
| [04 · Multiple accounts](prompts/04-multiple-accounts.md) | Show several Claude accounts in one office |
| [05 · Troubleshoot](prompts/05-troubleshoot.md) | Read-only diagnosis first, then fixes you approve |
| [06 · Uninstall](prompts/06-uninstall.md) | Remove the plugin, the service, the data and the folder, each with confirmation |
| [07 · Contribute](prompts/07-contribute.md) | Dev setup, a tested change, checks and a pull request |

## Specifications

The files in [`spec/`](spec/00-product.md) are the design specs that guided the implementation: [product](spec/00-product.md), [architecture](spec/01-architecture.md), [server](spec/02-server.md), [2D world](spec/03-world-2d.md), [UI](spec/04-ui.md), [plugin](spec/05-plugins.md), [3D world](spec/06-world-3d.md) and [process rules](spec/07-process.md). When a guide and a spec disagree, the code and the guides are current.

## Elsewhere in the repository

- [README](../README.md): the project front page (also in [Português](../README.pt-BR.md) and [Español](../README.es.md)).
- [CONTRIBUTING.md](../CONTRIBUTING.md), [AGENTS.md](../AGENTS.md) and [SECURITY.md](../SECURITY.md): how to contribute and how to report a vulnerability.
- [Server package notes](../packages/server/README.md) and [plugin notes](../packages/plugins/ai-office/README.md).
