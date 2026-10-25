// Where an agent's session runs. Codex sessions are read-only: the plugin hooks that answer permissions and deliver
// messages exist only for Claude Code, so the interface shows them but never offers those actions for them.
import { isCodex, type Agent } from '@ai-office/shared';
import { t } from '../../i18n';

export interface TeamSplit {
  /** Agents that can receive a message. */
  reachable: Agent[];
  /** Codex agents of the room: they are shown, but a message cannot reach them. */
  readOnly: Agent[];
}

export function splitTeam(agents: readonly Agent[]): TeamSplit {
  return { reachable: agents.filter((agent) => !isCodex(agent)), readOnly: agents.filter(isCodex) };
}

/** Why a message cannot be sent to this agent because of where it runs, or null when it can. */
export function messageBlockedBySource(agent: Pick<Agent, 'source'>): string | null {
  return isCodex(agent) ? t('codex.readonly.message') : null;
}

/** The note under the team composer when some of the room cannot receive the message; null when all can. */
export function skippedNote(split: TeamSplit): string | null {
  return split.readOnly.length > 0 && split.reachable.length > 0
    ? t('codex.readonly.skipped', { n: split.readOnly.length })
    : null;
}

/** The reason shown instead of the team composer when only read-only agents are in the room; null otherwise. */
export function teamBlockedBySource(split: TeamSplit): string | null {
  return split.reachable.length === 0 && split.readOnly.length > 0 ? t('codex.readonly.team') : null;
}
