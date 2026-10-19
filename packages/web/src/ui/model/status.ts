// Display status of an agent: the model status refined with what the UI wants to tell the user.
import type { Agent, ShellJob } from '@ai-office/shared';

export type DisplayStatus = 'working' | 'waiting' | 'shell' | 'idle' | 'done' | 'error' | 'offline';

export const STATUS_LABEL: Record<DisplayStatus, string> = {
  working: 'Trabalhando',
  waiting: 'Precisa de você',
  shell: 'Esperando o shell',
  idle: 'Ocioso',
  done: 'Concluído',
  error: 'Com erro',
  offline: 'Offline',
};

export const STATUS_HINT: Record<DisplayStatus, string> = {
  working: 'Processando um turno: lendo, editando ou pensando.',
  waiting: 'Parado até você aprovar, responder ou decidir algo.',
  shell: 'Aguardando um comando de shell terminar.',
  idle: 'Turno terminado; a sessão segue aberta.',
  done: 'Subagente terminou o trabalho e está saindo.',
  error: 'A última ação terminou com erro.',
  offline: 'Sessão encerrada; saindo do escritório.',
};

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

export interface ShellStage {
  index: number;
  label: string;
}

export const SHELL_STAGES: readonly { afterMs: number; label: string }[] = [
  { afterMs: 0, label: 'Iniciando' },
  { afterMs: 5_000, label: 'Rodando' },
  { afterMs: 60_000, label: 'Demorando' },
  { afterMs: 300_000, label: 'Execução longa' },
];

/** Where a shell job is on its lifecycle, based on how long it has been running. */
export function shellStage(job: Pick<ShellJob, 'startedAt'>, now: number): ShellStage {
  const elapsed = Math.max(0, now - job.startedAt);
  let index = 0;
  SHELL_STAGES.forEach((stage, i) => {
    if (elapsed >= stage.afterMs) index = i;
  });
  return { index, label: SHELL_STAGES[index].label };
}

/** Longest running shell of an agent (the one worth showing as the headline). */
export function primaryShell(agent: Agent): ShellJob | undefined {
  return agent.shells.reduce<ShellJob | undefined>((best, shell) => (!best || shell.startedAt < best.startedAt ? shell : best), undefined);
}
