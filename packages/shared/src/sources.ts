// Session sources: Claude Code and OpenAI Codex CLI. Codex sessions are read-only (the plugin hooks that answer
// permissions and deliver messages exist only for Claude Code), so the UI asks `isCodex` before offering those actions.
import type { AgentSource } from './model';

/** Id of the (first) Codex account; further Codex homes get `codex-<slug>`. */
export const CODEX_ACCOUNT_ID = 'codex';
/** Name of the Codex account chip: a product name, not translated. */
export const CODEX_LABEL = 'Codex';
/** Accent of the Codex account (ring and name tag in the worlds): distinct from the Claude account palette. */
export const CODEX_COLOR = '#d946ef';

export function isCodex(value: { source?: AgentSource | undefined } | undefined): boolean {
  return value?.source === 'codex';
}

export function sourceOf(value: { source?: AgentSource | undefined } | undefined): AgentSource {
  return value?.source === 'codex' ? 'codex' : 'claude';
}

/** Settings of the Codex integration that live on the server (GET / POST /api/codex/settings). */
export interface CodexSettings {
  /** The office reads Codex sessions (on by default whenever a Codex home exists). */
  sessions: boolean;
  /** A Codex home exists on this computer. */
  available: boolean;
  /** The server was started with AI_OFFICE_CODEX=0: Settings cannot turn it on. */
  locked: boolean;
}
