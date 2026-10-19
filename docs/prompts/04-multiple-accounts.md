# Prompt 04 · Use several Claude accounts

This prompt makes an agent with terminal access find your Claude Code config folders (`~/.claude`, `~/.claude-work`, ...), decide whether AI Office needs to be told about them, install the plugin in each account and check that every account shows up in the office.

Use it if you run Claude Code with more than one account or config folder. The rules behind it are in [configuration](../04-configuration.md#multiple-accounts).

## How to use

From a clone of this repository, in Claude Code or Codex:

```text
Read docs/prompts/04-multiple-accounts.md in this repository and execute the entire block in the "Prompt" section.
```

From any folder, without a clone:

```text
Read https://raw.githubusercontent.com/tfavareto/ai-office/main/docs/prompts/04-multiple-accounts.md and execute the entire block in the "Prompt" section on this computer.
```

## Prompt

```markdown
# Task: make every Claude Code account show up in AI Office

You are an agent with terminal access on the user's computer (macOS or Linux). AI Office is installed (see https://raw.githubusercontent.com/tfavareto/ai-office/main/docs/prompts/01-install-and-run.md). Make sure every Claude Code account is watched by the server and has the AI Office plugin installed, then verify each one and report.

## Background you need

- An account is a Claude Code config folder. The server auto-detects `~/.claude` and every `~/.claude-<name>` folder that contains a `projects/` subfolder, plus the folder in `CLAUDE_CONFIG_DIR` if set. It re-checks about every 10 seconds.
- If `AI_OFFICE_CLAUDE_DIRS` (comma-separated folders) is set, it replaces auto-detection completely: list every account, including `~/.claude`.
- The plugin installer (`npm run plugin:install`) detects accounts the same way. It also reads `AI_OFFICE_CLAUDE_DIRS`, and accepts `--account <dir>` (repeatable), which replaces detection.
- In the office, `~/.claude` is labeled "Personal" ("Pessoal" in the Portuguese interface); another folder is labeled with the text after `claude-`.

## Authorization and limits

You are authorized to:
- run read-only checks (`ls`, `test -d`, counting files in `sessions/`, `printenv CLAUDE_CONFIG_DIR`, `curl` to 127.0.0.1);
- in the AI Office folder: `npm run plugin:install -- --dry-run`, `npm run plugin:install` and `npm run plugin:status`, with `--account` or `AI_OFFICE_CLAUDE_DIRS` when needed.

You are NOT authorized to, and must ask the user first if you think it is needed:
- read the contents of any transcript (`projects/**/*.jsonl`) or session file; you only need to know that folders and counts exist;
- edit any file under `~/.claude*`, shell profiles or system settings;
- change the login service file or restart the server (ask, and say exactly what you will change);
- delete anything, use `sudo`, or push to any remote.

Secrets: never print, copy or ask for the contents of `~/.ai-office/token` or any credentials file in a `~/.claude*` folder.

If a step fails, stop and show the error with a proposal.

## Steps

1. Locate AI Office. Ask for the folder (propose `~/ai-office`); call it `<dir>`. It must contain `packages/plugins/scripts/install.mjs`. Check that the server answers: `curl -s -m 3 http://127.0.0.1:4848/api/health` must print `{"ok":true}`; otherwise tell the user to start it (prompt 01 or 02) and stop.

2. Find the account folders. For each entry of `ls -d ~/.claude* 2>/dev/null` that is a directory:
   - note whether `<entry>/projects` exists (an account without it is not detected by the server);
   - note how many files `<entry>/sessions/*.json` has (open sessions right now); count only, never open them.
   Also run `printenv CLAUDE_CONFIG_DIR` and note the path if one is set.
   Show the user a table: folder, has `projects/`, open sessions.

3. Confirm the list with the user. Ask which folders are real accounts to show, and whether they use any config folder that is not in their home folder or not named `.claude` / `.claude-<name>` (for example one set by a shell alias with `CLAUDE_CONFIG_DIR=...`).

4. Decide whether explicit configuration is needed.
   - If every account is `~/.claude` or `~/.claude-<name>` with a `projects/` folder, nothing needs configuring: the server already finds them. Say so and go to step 6.
   - Otherwise build the explicit list, for example `AI_OFFICE_CLAUDE_DIRS=$HOME/.claude,$HOME/.claude-work,/path/to/other`. It must include every account, `~/.claude` too.

5. Apply an explicit list (skip if not needed). Ask the user how the server is started and propose one option, then wait for approval:
   - It runs as a login service (prompt 02): add `AI_OFFICE_CLAUDE_DIRS` to the service file (macOS: an `EnvironmentVariables` dictionary in `~/Library/LaunchAgents/com.ai-office.server.plist`; Linux: an `Environment=` line under `[Service]` in `~/.config/systemd/user/ai-office.service`), then restart the service (`launchctl kickstart -k "gui/$(id -u)/com.ai-office.server"` or `systemctl --user daemon-reload` then `systemctl --user restart ai-office.service`).
   - It runs as a plain background process: stop and start it with `AI_OFFICE_CLAUDE_DIRS=... node packages/server/dist/index.js` from `<dir>` (only the AI Office server process, with permission).
   Use absolute paths in the list when writing it into a service file.

6. Install the plugin in every account. In `<dir>`:
   - preview: `npm run plugin:install -- --dry-run` (when the list is explicit, prefix the command with `AI_OFFICE_CLAUDE_DIRS=<list>` or add one `--account <dir>` per account; add `--claude <path>` if the `claude` CLI is not on PATH, checking `~/.local/bin/claude` and `~/.claude/local/claude`);
   - show the user which accounts and commands it prints, then run the same command without `--dry-run`;
   - `npm run plugin:status` must show `marketplace: added` and `plugin: installed ... (up to date)` for each account.

7. Verify that every account is watched. Run this, which reads the token without printing it:
   `printf 'Authorization: Bearer %s\n' "$(cat ~/.ai-office/token)" | curl -s -H @- http://127.0.0.1:4848/api/health`
   The `accounts` array must list one entry per account with its `dir` and `sessions` count. Compare it with the table from step 2 and report any missing account. Do not print the token or any header. Also ask the user to look at the top bar of the office: there is one usage card per account, and the sidebar has a chip per account.

8. Tell the user to restart the Claude Code sessions of every account so they load the plugin hooks, and that a permission request or message will only reach sessions started after that.

## Verification checklist

- Each real account folder has `projects/` and appears in the health output.
- `npm run plugin:status` shows the plugin up to date for each account.
- The office shows one usage card per account.

## Final report

Reply with exactly this structure and nothing secret in it:

- Accounts found: folder, label in the office, has `projects/`, open sessions.
- Configuration: auto-detection was enough, or the exact `AI_OFFICE_CLAUDE_DIRS` list and where it was applied.
- Plugin: status per account.
- Server health: accounts listed by the server and any that are missing.
- Still to do by the user: restart Claude Code sessions in each account.
- Problems or questions.
```

## Next

- [Prompt 05 · Troubleshoot](05-troubleshoot.md) if an account is still missing.
- [Troubleshooting: accounts not detected](../08-troubleshooting.md#multiple-accounts-are-not-detected)
- [Plugin guide](../03-plugin.md#multiple-accounts)
- [Prompt catalog](README.md)
