# Prompt 07 · Contribute a change

This prompt makes an agent with terminal access set up the development environment, learn the repository's rules, implement one small change tests-first, run every check, make a conventional commit on a new branch and prepare a pull request. It never pushes or opens the pull request until you explicitly ask.

Use it to fix a bug, add a small feature or improve the docs. The human version of this workflow is in [CONTRIBUTING.md](../../CONTRIBUTING.md); agents also follow [AGENTS.md](../../AGENTS.md).

## How to use

From a clone of this repository, in Claude Code or Codex (describe your change after the sentence):

```text
Read docs/prompts/07-contribute.md in this repository and execute the entire block in the "Prompt" section. The change I want: <describe it here>.
```

From any folder, without a clone:

```text
Read https://raw.githubusercontent.com/tfavareto/ai-office/main/docs/prompts/07-contribute.md and execute the entire block in the "Prompt" section on this computer. The change I want: <describe it here>.
```

## Prompt

```markdown
# Task: make one small, tested contribution to AI Office

You are an agent with terminal access on the user's computer (macOS or Linux). The user wants to contribute a change to https://github.com/tfavareto/ai-office. If the user did not describe the change, ask for it first in one or two sentences, and confirm the scope: one logical change, small and focused.

## Authorization and limits

You are authorized to:
- run read-only checks and read any file in the repository;
- clone the repository (or use the existing clone the user points to), run `npm install`, and create a new local branch;
- edit files inside the repository that the change needs, including its tests and the docs it affects;
- run `npm run dev`, `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`, `npm run docs:check` and `npm run docs:test`;
- make local commits on your new branch.

You are NOT authorized to, until the user explicitly asks for it in this conversation:
- push to any remote, open or update a pull request or issue, publish anything, or create a fork;
- commit on `main`, rewrite history, or force anything.

Also never: use `sudo`; weaken a security guard (token, Host/Origin/Sec-Fetch-Site checks, CSP, loopback-only features, size and time limits); put real project names, session content, transcripts, tokens, personal paths or e-mails in code, tests, docs or screenshots (screenshots come from demo mode only); or edit files outside the scope of the change (mention unrelated problems in your report instead).

If a step fails, stop and show the error with a proposal.

## Steps

1. Environment. `node --version` must be v22 or newer; run `npm --version` and `git --version`. Locate or create the clone: ask whether to use an existing one or clone to a folder the user chooses (propose `~/ai-office`): `git clone https://github.com/tfavareto/ai-office.git <dir>`. Work in `<dir>`. Check `git status --short` is clean and the branch is `main`, then `npm install`.

2. Learn the rules. Read `AGENTS.md`, `CONTRIBUTING.md`, `docs/README.md` and the specs relevant to the change (`docs/spec/`), plus the README of the package you will touch. Summarize to the user in five lines the rules that matter for this change (strict TypeScript, no `any`, tests for logic, UI text in Brazilian Portuguese, English everywhere else, conventional commits, docs and prompts updated with the change).

3. Plan. State the plan in a few bullets: files you expect to touch, the test you will write first, the docs you will update. If the change touches `packages/shared`, plan to update server, web, their tests and the spec together. Wait for the user to approve the plan if it is more than a trivial edit.

4. Branch. `git switch -c <type>/<short-description>` where `<type>` is one of feat, fix, refactor, docs, test, chore, perf, ci.

5. See it run (when the change is visible). Start `npm run dev` in the background with its output in a log file, then open the URL it prints (the Vite dev server, usually http://localhost:5173). For work that needs agents but no real sessions, use demo mode: run the server with `AI_OFFICE_DEMO=1` or add `?mock=1` to the page URL. Note that `npm run dev` leaves a server on port 4848; stop only the processes you started when you are done.

6. Test first (red). Write the smallest test that expresses the new behavior or reproduces the bug, next to the code (Vitest, Arrange-Act-Assert, a descriptive name, synthetic fixtures only). Run it for the right package, for example `npx vitest run --project server <path>`, and confirm it fails for the right reason. Documentation-only changes skip this step but still need `npm run docs:check`.

7. Implement (green). Make the minimal change that passes the test, following the conventions: small focused files, immutable updates and pure functions where possible, explicit error handling, validated external input, no console noise, no dead code or TODOs. Run the test again and confirm it passes.

8. Refactor and complete. Clean up, then update every doc, link and prompt that the change affects. If `README.md` changed, keep `README.pt-BR.md` and `README.es.md` aligned with the same sections and anchors. Add CC0 or original assets only, credited in `packages/web/public/assets/3d/CREDITS.md`.

9. Run all checks and fix what they report:
   - `npm run typecheck`
   - `npm run lint`
   - `npm test`
   - `npm run build`
   - `npm run docs:check` (and `npm run docs:test` if you touched `scripts/`)
   All must pass. Do not weaken or skip a test to make it pass; fix the implementation, unless the test itself is wrong.

10. Review your own diff: `git diff` and `git status`. Look for secrets, personal paths, real session content, debug output, unrelated edits and missing tests. If the change touches authentication, request handling, file access or the hooks, say so explicitly in your report as security-sensitive.

11. Commit locally with a conventional message in English, one logical change: `<type>: <description>` (types: feat, fix, refactor, docs, test, chore, perf, ci), with a short body saying what and why when it helps. Show `git log -1 --stat`.

12. Prepare the pull request, do not open it. Draft the title (same style as the commit) and a description that fills the repository template at `.github/PULL_REQUEST_TEMPLATE.md`: Summary, Why, Checks run (tick the ones you ran), Screenshots (demo mode only, if the UI changed) and the Docs and translations checklist. Print the draft. Then ask the user whether they want you to push the branch and open the pull request. Only after an explicit yes: ask which remote or fork to use, push the branch with `git push -u origin <branch>` (or to the user's fork), and open the pull request with `gh pr create` using the drafted text. Never force-push and never push to `main`.

## Final report

Reply with exactly this structure and nothing secret in it:

- Change: one-paragraph summary and the branch name.
- Files touched, including the test written first and the docs updated.
- Checks: typecheck, lint, test (counts), build, docs check, each pass or fail.
- Commit: hash and message.
- Security-sensitive: yes or no, and why.
- Pull request: draft ready, pushed and opened (only if the user asked, with the link), or not opened.
- Open questions or follow-ups noticed but not done.
```

## Next

- [CONTRIBUTING.md](../../CONTRIBUTING.md) and [AGENTS.md](../../AGENTS.md)
- [Architecture](../07-architecture.md) and the [specs](../spec/00-product.md)
- [Evidence and limits](../06-validation.md) for the checks CI runs
- [Prompt catalog](README.md)
