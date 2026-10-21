// What the task board and the meeting-room whiteboard agree on: which agents take part, in which order, and the
// compact summary the worlds draw (counts per column and the first tasks in progress). Pure; no localization here.
import type { Agent, Msg, Project } from '@ai-office/shared';

/** In-progress titles the whiteboard may show. */
export const SUMMARY_TITLES = 3;

export interface SummaryTitle {
  text: string;
  /** Localizable form of `text` (demo tasks); real task texts have none and are shown as written. */
  msg?: Msg;
}

export interface TaskBoardSummary {
  pending: number;
  active: number;
  done: number;
  /** The first tasks in progress, in board order (rooms by arrival, then agents by arrival). */
  top: readonly SummaryTitle[];
}

/** Marker colors of the three columns on the whiteboard (same hue family as the board panel). */
export const TASK_COLUMN_COLORS = { pending: '#e0954a', active: '#2f6fed', done: '#2d9d6b' } as const;

export const EMPTY_TASK_BOARD: TaskBoardSummary = { pending: 0, active: 0, done: 0, top: [] };

/** The agent is still in the office: tasks of people who left (offline, finished subagents) are not on the board. */
export function isBoardAgent(agent: Agent): boolean {
  return agent.status !== 'offline' && agent.status !== 'done';
}

/** Board order of agents: rooms by arrival, then agents by arrival, then id (stable). */
export function compareBoardAgents(projects: readonly Project[]): (a: Agent, b: Agent) => number {
  const order = new Map(projects.map((project) => [project.id, project.order]));
  const rank = (agent: Agent): number => order.get(agent.projectId) ?? Number.MAX_SAFE_INTEGER;
  return (a, b) => rank(a) - rank(b) || a.startedAt - b.startedAt || a.id.localeCompare(b.id);
}

export function summarizeTaskBoard(agents: readonly Agent[], projects: readonly Project[]): TaskBoardSummary {
  const summary = { pending: 0, active: 0, done: 0 };
  const top: SummaryTitle[] = [];
  for (const agent of agents.filter(isBoardAgent).sort(compareBoardAgents(projects))) {
    for (const task of agent.tasks) {
      if (task.status === 'completed') summary.done++;
      else if (task.status === 'pending') summary.pending++;
      else {
        summary.active++;
        if (top.length < SUMMARY_TITLES)
          top.push(
            task.activeForm
              ? { text: task.activeForm, msg: task.activeFormMsg }
              : { text: task.title, msg: task.titleMsg },
          );
      }
    }
  }
  return { ...summary, top };
}

/** Changes whenever what the whiteboard draws changes (numbers, titles). */
export function taskBoardKey(summary: TaskBoardSummary): string {
  const titles = summary.top.map((title) => `${title.text}${title.msg ? JSON.stringify(title.msg) : ''}`).join('|');
  return `${summary.pending}/${summary.active}/${summary.done}|${titles}`;
}
