# Security policy

## Supported versions

Security fixes are made on `main` and released with the latest release. Older releases are not patched; update to the
latest one.

| Version        | Supported |
| -------------- | --------- |
| `main`         | Yes       |
| Latest release | Yes       |
| Anything older | No        |

## Scope

AI Office runs on your own computer. These parts are in scope:

- **Local server** (`packages/server`): the loopback bind, the access token, Host, Origin and `Sec-Fetch-Site` checks,
  the cookie, Content-Security-Policy and other response headers, request and stream limits, and the local-only
  features (terminal view, permissions, messages).
- **Plugin hooks** (`packages/plugins`): the `PermissionRequest`, `PostToolUse`, `Stop`, `SubagentStop` and
  `Notification` hooks, the health challenge that proves the server's identity before a token is sent, and the
  installer script.
- **Token handling**: creation and storage of `<state dir>/token` (mode `0600`, directory `0700`), how it is presented
  by hooks and by the page, and anything that could leak it.
- **Web app** (`packages/web`): injection, cross-site scripting, or anything that lets a web page or another local
  origin read data from the server or act on a session.
- **Privacy**: anything that makes the app send session content, paths or tokens off the machine. It should make no
  outbound network requests.

## Reporting a vulnerability

Please report privately through GitHub Security Advisories:
<https://github.com/tfavareto/ai-office/security/advisories/new>

Do not open a public issue or pull request for a vulnerability.

Include:

- What is affected (component, file or endpoint) and the commit or release you tested.
- Your OS, Node.js version and Claude Code version.
- Steps to reproduce, ideally with a minimal proof of concept.
- The impact you expect (for example: another local website can read the token).
- Logs or output, with tokens, personal paths and session content redacted.

## What to expect

This is a small project maintained by one person, so these are goals, not guarantees:

- Acknowledgement of your report within about 7 days.
- An assessment and a plan or a question within about 14 days.
- A fix on `main` and a release as soon as it is verified, with credit in the advisory if you want it.

Please give the maintainer reasonable time to fix the issue before disclosing it publicly.

## Out of scope

- Setting `AI_OFFICE_ALLOW_REMOTE=1` (or `--allow-remote`) and binding to a non-loopback address. This is an explicit
  opt-in. Even then browsers cannot sign in remotely and the local-only features stay off, but exposing the server to a
  network is your responsibility.
- Attacks that need access to your user account or file system, such as reading `<state dir>/token` or the Claude Code
  files directly, or changing the environment of the process.
- Vulnerabilities in Claude Code itself, in Node.js, or in third-party dependencies with no practical effect on AI Office
  (report those upstream).
- Denial of service by a user who already has local access to the machine.
- Findings that require disabling the guards on purpose, such as a modified build or a patched Host check.
- Missing hardening that does not lead to a concrete attack, and reports from automated scanners without a working
  proof of concept.
