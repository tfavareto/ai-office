// Synthetic offices for the team tests: every field a share must never carry holds a recognizable marker.
import { mulberry32, pick, randInt } from '../hash';
import type { Activity, ActivityKind, Agent, AgentStatus, Project } from '../model';
import type { ShareSource } from './sanitize';

/** Markers placed in fields that must stay on the computer unless a category is turned on. */
export const MARK = {
  path: 'MARK_PATH_zq7',
  folder: 'MARK_FOLDER_kx2',
  alias: 'MARK_ALIAS_mm4',
  session: 'MARK_SESSION_ab9',
  account: 'MARK_ACCOUNT_ww1',
  prompt: 'MARK_PROMPT_hh5',
  command: 'MARK_COMMAND_rr8',
  file: 'MARK_FILE_ff3',
  branch: 'MARK_BRANCH_bb6',
  task: 'MARK_TASK_tt2',
  waiting: 'MARK_WAITING_ww7',
  permission: 'MARK_PERMISSION_pp0',
  tokens: 7_777_771,
  cost: 3.141592653,
  model: 'MARK_MODEL_mo1',
} as const;

export const ALWAYS_ABSENT = [
  MARK.path,
  MARK.folder,
  MARK.session,
  MARK.account,
  MARK.command,
  MARK.task,
  MARK.waiting,
  MARK.permission,
  MARK.model,
] as const;

const KINDS: ActivityKind[] = ['read', 'edit', 'write', 'bash', 'search', 'web', 'think', 'reply', 'done', 'other'];
const STATUSES: AgentStatus[] = ['working', 'waiting', 'idle', 'idle', 'done', 'offline'];

function activity(n: number, kind: ActivityKind): Activity {
  return {
    id: `a-${n}`,
    at: 1_000,
    kind,
    icon: '📖',
    text: `Lendo ${MARK.file}.ts`,
    msg: { key: 'activity.read', params: { file: `${MARK.file}.ts` } },
    detail: `${MARK.command} --flag ${MARK.path}/x`,
  };
}

export function fakeAgent(i: number, projectId: string, rng: () => number, now: number): Agent {
  const status = pick(rng, STATUSES);
  const kind = rng() < 0.25 ? 'sub' : 'main';
  return {
    id: `${MARK.session}-${i}`,
    kind,
    sessionId: `${MARK.session}-s${i}`,
    accountId: `${MARK.account}-${i}`,
    projectId,
    name: `Pessoa ${i}`,
    role: kind === 'main' ? 'Principal' : MARK.command,
    title: `${MARK.prompt} ${i}`,
    look: rng() < 0.5 ? 'f' : 'm',
    seed: randInt(rng, 0, 1e9),
    status,
    statusSince: now - randInt(rng, 0, 600_000),
    activity: activity(i, pick(rng, KINDS)),
    recent: [activity(i + 1000, 'read')],
    tasks: [{ id: 't', title: MARK.task, status: 'in_progress' }],
    shells: [
      {
        id: 'sh',
        label: MARK.command,
        command: MARK.command,
        background: true,
        kind: 'shell',
        startedAt: now - 5000,
      },
    ],
    stats: {
      toolCalls: 3,
      tokensIn: MARK.tokens - 1,
      tokensOut: 1,
      costUSD: MARK.cost,
      linesAdded: 1,
      linesRemoved: 1,
      subagents: 0,
    },
    model: MARK.model,
    gitBranch: `${MARK.branch}/${i}`,
    permissionMode: 'default',
    permission: {
      id: 'p',
      agentId: `${MARK.session}-${i}`,
      toolName: 'Bash',
      summary: MARK.permission,
      input: { command: MARK.command },
      suggestions: [],
      createdAt: now,
      expiresAt: now + 1,
    },
    waitingFor: MARK.waiting,
    startedAt: now - 700_000 + i,
    lastEventAt: now,
  };
}

export function fakeProject(i: number): Project {
  return {
    id: `${MARK.path}/${MARK.folder}-${i}`,
    name: `${MARK.alias}-${i}`,
    path: `${MARK.path}/${MARK.folder}-${i}`,
    originalName: `${MARK.folder}-${i}`,
    seed: i * 977,
    order: i,
  };
}

/** A random office: 0..6 rooms and 0..60 agents, with the markers everywhere. */
export function randomOffice(seed: number, now = 1_000_000): ShareSource {
  const rng = mulberry32(seed);
  const projects = Array.from({ length: randInt(rng, 0, 6) }, (_, i) => fakeProject(i));
  const agents =
    projects.length === 0
      ? []
      : Array.from({ length: randInt(rng, 0, 60) }, (_, i) =>
          fakeAgent(i, (pick(rng, projects) as Project).id, rng, now),
        );
  return { projects, agents };
}
