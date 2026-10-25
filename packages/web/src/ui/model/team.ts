// The team as the page draws it: the other computers' people become extra accounts (one per member), rooms ("Ana ·
// Projeto 1") and agents, in the same shapes the worlds and the sidebar already know, with ids that start with
// `team:` so nothing can mistake them for a local session. They carry no permission, no tasks, no shells: only what the
// members chose to share.
import {
  fnv1a,
  isTeamId,
  memberColor,
  memberInitial,
  TEAM_ID_PREFIX,
  type Account,
  type ActivityKind,
  type Agent,
  type OfficeSnapshot,
  type Project,
  type TeamAgent,
  type TeamPerson,
  type TeamSnapshot,
} from '@ai-office/shared';
import { t } from '../../i18n';

export interface TeamOverlay {
  accounts: Account[];
  projects: Project[];
  agents: Agent[];
}

export const EMPTY_OVERLAY: TeamOverlay = { accounts: [], projects: [], agents: [] };

export type TeamFilter = 'all' | 'mine' | 'team';

const ACTIVITY_ICONS: Readonly<Record<ActivityKind, string>> = {
  prompt: '📨',
  think: '💭',
  reply: '💬',
  read: '📖',
  search: '🔎',
  edit: '✏️',
  write: '📝',
  bash: '💻',
  web: '🌐',
  task: '📋',
  subagent: '👥',
  mcp: '🔌',
  question: '❓',
  permission: '🔐',
  message: '✉️',
  error: '⚠️',
  done: '✅',
  other: '⚙️',
};

export const accountIdOf = (personId: string): string => `${TEAM_ID_PREFIX}${personId}`;
export const roomIdOf = (personId: string, roomKey: string): string => `${TEAM_ID_PREFIX}${personId}:${roomKey}`;
export const agentIdOf = (personId: string, agentKey: string): string => `${TEAM_ID_PREFIX}${personId}:${agentKey}`;

/** Which member a `team:` id belongs to (account, room or agent id). */
export function personIdOf(id: string): string | undefined {
  if (!isTeamId(id)) return undefined;
  return id.slice(TEAM_ID_PREFIX.length).split(':')[0];
}

function accountOf(person: TeamPerson): Account {
  return {
    id: accountIdOf(person.id),
    label: person.name,
    initial: memberInitial(person.name),
    color: memberColor(person.id),
    dir: '',
  };
}

function agentOf(person: TeamPerson, source: TeamAgent, mainInRoom: string | undefined): Agent {
  const id = agentIdOf(person.id, source.key);
  const kind = source.kind === 'sub' && mainInRoom !== undefined ? 'sub' : 'main';
  const activityKind = source.activityKind;
  const msg = source.activityMsg ?? (activityKind !== undefined ? { key: `team.act.${activityKind}` } : undefined);
  return {
    id,
    kind,
    sessionId: id,
    accountId: accountIdOf(person.id),
    projectId: roomIdOf(person.id, source.roomKey),
    ...(kind === 'sub' && mainInRoom !== undefined ? { parentId: mainInRoom } : {}),
    name: source.name,
    role: kind === 'sub' ? 'Sub' : 'Principal',
    ...(kind === 'sub' ? { roleMsg: { key: 'team.role.sub' } } : {}),
    ...(source.title !== undefined ? { title: source.title } : {}),
    look: source.look,
    ...(source.appearance !== undefined ? { appearance: source.appearance } : {}),
    seed: fnv1a(id),
    status: source.status,
    statusSince: source.since,
    ...(source.status === 'waiting'
      ? { waitingFor: t('team.status.waiting'), waitingForMsg: { key: 'team.status.waiting' } }
      : {}),
    ...(activityKind !== undefined && msg !== undefined
      ? {
          activity: {
            id: `${id}:activity`,
            at: source.since,
            kind: activityKind,
            icon: ACTIVITY_ICONS[activityKind],
            text: source.activityText ?? t(`team.act.${activityKind}` as 'team.act.read'),
            msg,
          },
        }
      : {}),
    recent: [],
    tasks: [],
    shells: [],
    stats: {
      toolCalls: 0,
      tokensIn: source.tokens ?? 0,
      tokensOut: 0,
      ...(source.costUSD !== undefined ? { costUSD: source.costUSD } : {}),
      linesAdded: 0,
      linesRemoved: 0,
      subagents: 0,
    },
    ...(source.branch !== undefined ? { gitBranch: source.branch } : {}),
    startedAt: source.since,
    lastEventAt: source.since,
    ...(source.source !== undefined ? { source: source.source } : {}),
  };
}

/** The accounts, rooms and people of everybody in the team but this computer. Rooms come after `firstOrder`. */
export function teamOverlay(team: TeamSnapshot | undefined, firstOrder: number): TeamOverlay {
  if (team === undefined) return EMPTY_OVERLAY;
  const accounts: Account[] = [];
  const projects: Project[] = [];
  const agents: Agent[] = [];
  let order = firstOrder;
  for (const person of team.people) {
    if (!person.online || person.rooms.length === 0) continue;
    accounts.push(accountOf(person));
    const color = memberColor(person.id);
    for (const room of person.rooms) {
      const id = roomIdOf(person.id, room.key);
      const label = room.name ?? t('team.room', { n: room.index });
      projects.push({
        id,
        name: t('team.room.full', { member: person.name, room: label }),
        path: '',
        seed: fnv1a(id),
        order: order++,
        theme: { color },
      });
      const inRoom = person.agents.filter((agent) => agent.roomKey === room.key);
      const main = inRoom.find((agent) => agent.kind === 'main');
      const mainId = main === undefined ? undefined : agentIdOf(person.id, main.key);
      for (const agent of inRoom) agents.push(agentOf(person, agent, mainId));
    }
  }
  return { accounts, projects, agents };
}

/** The snapshot with the team added (`all`), only the team (`team`), or as it is (`mine`). */
export function withTeam(snapshot: OfficeSnapshot, overlay: TeamOverlay, filter: TeamFilter = 'all'): OfficeSnapshot {
  if (filter === 'mine' || overlay === EMPTY_OVERLAY) return snapshot;
  if (filter === 'team')
    return { ...snapshot, accounts: overlay.accounts, projects: overlay.projects, agents: overlay.agents };
  return {
    ...snapshot,
    accounts: [...snapshot.accounts, ...overlay.accounts],
    projects: [...snapshot.projects, ...overlay.projects],
    agents: [...snapshot.agents, ...overlay.agents],
  };
}

/** First order a team room may take: after every local room. */
export function firstTeamOrder(snapshot: OfficeSnapshot): number {
  return snapshot.projects.reduce((max, project) => Math.max(max, project.order + 1), 0);
}

export interface TeamCounts {
  online: number;
  total: number;
  agents: number;
}

export function teamCounts(team: TeamSnapshot | undefined): TeamCounts {
  const people = team?.people ?? [];
  return {
    online: people.filter((person) => person.online).length,
    total: people.length,
    agents: people.reduce((sum, person) => sum + person.agents.length, 0),
  };
}
