// Still images of the office for sharing: what a world's `capture` is asked for, and the privacy filter every capture
// applies. A capture never draws from the live scene: it builds a throwaway office from a sanitized copy of the
// snapshot, so a project name, a task title or a git branch cannot end up in the picture by accident.
import type { Account, Agent, OfficeSnapshot, Project, ShellJob, TaskItem } from '@ai-office/shared';

export type CaptureMode = 'overview' | 'current';

export interface CaptureOptions {
  /** Size of the returned canvas, in pixels. */
  width: number;
  height: number;
  /** `overview` frames the whole building; `current` frames what the live camera shows. */
  mode: CaptureMode;
  /** Draw the real project names on the room signs. Off by default: rooms are labelled "Room 1", "Room 2"... */
  showProjectNames?: boolean;
}

export const MIN_CAPTURE_SIDE = 16;
export const MAX_CAPTURE_SIDE = 4096;

/** A requested size as whole pixels inside the supported range. */
export function captureSize(opts: Pick<CaptureOptions, 'width' | 'height'>): { width: number; height: number } {
  const side = (value: number): number =>
    Math.min(
      MAX_CAPTURE_SIDE,
      Math.max(MIN_CAPTURE_SIDE, Math.round(Number.isFinite(value) ? value : MIN_CAPTURE_SIDE)),
    );
  return { width: side(opts.width), height: side(opts.height) };
}

export interface CapturePrivacy {
  showProjectNames: boolean;
  /** Generic name of the nth room (1-based), in the language of the capture. */
  roomLabel: (n: number) => string;
}

/** Seed of the throwaway simulation: the same office always poses the same way. */
export const CAPTURE_SEED = 20260101;
/** Simulated seconds before the picture is taken, so everybody has settled at their desk. */
export const CAPTURE_SETTLE_SECONDS = 1;

function plainTask(task: TaskItem): TaskItem {
  return { id: task.id, status: task.status, title: '' };
}

function plainShell(shell: ShellJob): ShellJob {
  return { id: shell.id, label: '', background: shell.background, kind: shell.kind, startedAt: shell.startedAt };
}

function plainAgent(agent: Agent, projectId: string): Agent {
  const { activity } = agent;
  return {
    id: agent.id,
    kind: agent.kind,
    sessionId: agent.id,
    accountId: agent.accountId,
    projectId,
    ...(agent.parentId !== undefined ? { parentId: agent.parentId } : {}),
    name: agent.name,
    role: agent.kind === 'main' ? 'Principal' : 'Sub',
    look: agent.look,
    seed: agent.seed,
    status: agent.status,
    statusSince: agent.statusSince,
    ...(activity !== undefined
      ? { activity: { id: activity.id, at: activity.at, kind: activity.kind, icon: '', text: '' } }
      : {}),
    recent: [],
    tasks: agent.tasks.map(plainTask),
    shells: agent.shells.map(plainShell),
    stats: agent.stats,
    startedAt: agent.startedAt,
    lastEventAt: agent.lastEventAt,
  };
}

function plainAccount(account: Account): Account {
  return { id: account.id, label: account.initial, initial: account.initial, color: account.color, dir: '' };
}

/**
 * The part of a snapshot a picture may use: how many rooms and people there are, what they are doing (the kind of
 * activity, their status) and the colors. Everything the user wrote or the machine knows is left out: folder paths,
 * session titles, task and activity texts, branches, pending permissions and hires. Project names stay only when
 * `showProjectNames` is on; otherwise each room is numbered in the order it arrived.
 */
export function captureSnapshot(snapshot: OfficeSnapshot, privacy: CapturePrivacy): OfficeSnapshot {
  const ordered = [...snapshot.projects].sort((a, b) => a.order - b.order);
  const ids = new Map(ordered.map((project, index) => [project.id, `room-${index + 1}`]));
  const projects: Project[] = ordered.map((project, index) => ({
    id: `room-${index + 1}`,
    name: privacy.showProjectNames ? project.name : privacy.roomLabel(index + 1),
    path: '',
    seed: project.seed,
    order: index,
  }));
  const agents = snapshot.agents.flatMap((agent) => {
    const projectId = ids.get(agent.projectId);
    return projectId === undefined ? [] : [plainAgent(agent, projectId)];
  });
  return {
    rev: snapshot.rev,
    serverTime: snapshot.serverTime,
    meta: {
      version: snapshot.meta.version,
      startedAt: snapshot.meta.startedAt,
      local: false,
      demo: snapshot.meta.demo,
    },
    accounts: snapshot.accounts.map(plainAccount),
    projects,
    agents,
    usage: [],
    // The level (the decoration it unlocked) shows; the employee of the month's name and the unlock list do not.
    ...(snapshot.progress !== undefined ? { progress: { ...snapshot.progress, recent: [], employee: undefined } } : {}),
  };
}

/** An office with nobody in it: what a world that has not received a snapshot yet captures. */
export const EMPTY_CAPTURE_SNAPSHOT: OfficeSnapshot = {
  rev: 0,
  serverTime: 0,
  meta: { version: '', startedAt: 0, local: false, demo: false },
  accounts: [],
  projects: [],
  agents: [],
  usage: [],
};
