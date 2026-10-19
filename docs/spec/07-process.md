# Process rules (for every contributor and agent)

- **Clean-room recreation.** This is an original project written from this specification. Do not read, copy or
  paraphrase code from any other project on disk (in particular any directory outside `ai-office/`). Use only: this
  spec, the shared contract, public documentation (Node, three.js, Claude Code docs) and the structure of real Claude
  Code files on this machine (read structure/fields only; never copy real conversation content into the repo).
- Quality bar: professional, idiomatic TypeScript; strict types; small modules; tests for logic (parsers, sim,
  registries, hooks, store); no dead code; no TODOs left behind; no console noise in production paths.
- Each package must pass `npx tsc -p packages/<pkg>` and `npx vitest run --project <pkg>`.
- Do not modify files owned by another workstream unless the task says so; if a shared contract change is required,
  stop and report it instead of editing `packages/shared` (the orchestrator owns it).
- Commit nothing (the orchestrator commits).
