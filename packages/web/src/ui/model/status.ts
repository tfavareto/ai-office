// Display status of an agent: the model status refined with what the UI wants to tell the user.
import type { Agent, ShellJob } from '@ai-office/shared';
import { t } from '../../i18n';

export type DisplayStatus = 'working' | 'waiting' | 'shell' | 'idle' | 'done' | 'error' | 'offline';

export function statusLabel(status: DisplayStatus): string {
  return t(`status.${status}`);
}

export function statusHint(status: DisplayStatus): string {
  return t(`status.hint.${status}`);
}

export function hasForegroundShell(agent: Agent): boolean {
  return agent.shells.some((shell) => !shell.background && shell.kind === 'shell');
}

export function displayStatus(agent: Agent): DisplayStatus {
  switch (agent.status) {
    case 'waiting':
      return 'waiting';
    case 'done':
      return 'done';
    case 'offline':
      return 'offline';
    case 'working':
      return hasForegroundShell(agent) ? 'shell' : 'working';
    case 'idle':
      if (agent.shells.length > 0) return 'shell';
      return agent.activity?.error ? 'error' : 'idle';
  }
}

/** The agent is present in the office (not leaving). */
export function isLive(agent: Agent): boolean {
  return agent.status !== 'offline' && agent.status !== 'done';
}

/** Sort weight: who needs attention comes first. */
export function statusRank(status: DisplayStatus): number {
  switch (status) {
    case 'waiting':
      return 0;
    case 'error':
      return 1;
    case 'working':
      return 2;
    case 'shell':
      return 3;
    case 'idle':
      return 4;
    case 'done':
      return 5;
    case 'offline':
      return 6;
  }
}

export type ShellStageId = 'starting' | 'running' | 'slow' | 'long';

export interface ShellStage {
  index: number;
  id: ShellStageId;
  label: string;
}

export const SHELL_STAGES: readonly { afterMs: number; id: ShellStageId }[] = [
  { afterMs: 0, id: 'starting' },
  { afterMs: 5_000, id: 'running' },
  { afterMs: 60_000, id: 'slow' },
  { afterMs: 300_000, id: 'long' },
];

export function shellStageLabel(id: ShellStageId): string {
  return t(`shell.stage.${id}`);
}

/** Where a shell job is on its lifecycle, based on how long it has been running. */
export function shellStage(job: Pick<ShellJob, 'startedAt'>, now: number): ShellStage {
  const elapsed = Math.max(0, now - job.startedAt);
  let index = 0;
  SHELL_STAGES.forEach((stage, i) => {
    if (elapsed >= stage.afterMs) index = i;
  });
  const { id } = SHELL_STAGES[index];
  return { index, id, label: shellStageLabel(id) };
}

/** Longest running shell of an agent (the one worth showing as the headline). */
export function primaryShell(agent: Agent): ShellJob | undefined {
  return agent.shells.reduce<ShellJob | undefined>((best, shell) => (!best || shell.startedAt < best.startedAt ? shell : best), undefined);
}
