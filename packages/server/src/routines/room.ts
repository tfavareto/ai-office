// A room as a routine sees it: which real terminals are free, and whose account the room works on.
import type { Account, Agent, Project } from '@ai-office/shared';

const TYPING_GRACE_MS = 60_000;

export interface RoomState {
  projects: readonly Project[];
  agents: readonly Agent[];
}

export interface RoomTerminals {
  list(): readonly { id: string; cwd: string; exitCode?: number | null | undefined }[];
  typedAt(id: string): number | undefined;
}

/** One still without a session, or written to in the last minute, is not free: Enter would send a half-written message. */
export function routineTerminals(
  state: RoomState,
  terminals: RoomTerminals,
  path: string,
  now: number,
): { id: string; busy: boolean }[] {
  const room = state.projects.find((project) => project.path === path);
  const linked = state.agents.flatMap((agent) =>
    agent.projectId === room?.id && agent.terminalId !== undefined ? [{ agent, id: agent.terminalId }] : [],
  );
  const free = (agent: Agent, id: string): boolean => {
    const typedAt = terminals.typedAt(id);
    const typing = typedAt !== undefined && now - typedAt < TYPING_GRACE_MS;
    return (agent.status === 'idle' || agent.status === 'done') && !typing;
  };
  const waiting = terminals
    .list()
    .filter(
      (terminal) =>
        terminal.exitCode === undefined &&
        terminal.cwd === path &&
        !state.agents.some((agent) => agent.terminalId === terminal.id),
    );
  return [
    ...linked.map(({ agent, id }) => ({ id, busy: !free(agent, id) })),
    ...waiting.map((terminal) => ({ id: terminal.id, busy: true })),
  ];
}

/** The account the room's agents use, so a routine bills the same one; undefined means the default. */
export function roomAccount(state: RoomState, accounts: readonly Account[], path: string): string | undefined {
  const room = state.projects.find((project) => project.path === path);
  return state.agents.find(
    (agent) => agent.projectId === room?.id && accounts.some((account) => account.id === agent.accountId),
  )?.accountId;
}
