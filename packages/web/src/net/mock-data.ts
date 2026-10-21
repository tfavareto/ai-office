// Synthetic server data for `?mock=1`: transcripts, sessions and day stats derived from the simulated agents.
import { t } from '../i18n';
import { activityDetail, activityText, agentTitle, uiMsg } from '../ui/display';
import type {
  Activity,
  ActivityKind,
  Agent,
  DayStats,
  OfficeSnapshot,
  RecentSession,
  TranscriptEntry,
  TranscriptPage,
} from '@ai-office/shared';

const TOOL_NAMES: Partial<Record<ActivityKind, string>> = {
  read: 'Read',
  search: 'Grep',
  edit: 'Edit',
  write: 'Write',
  bash: 'Bash',
  web: 'WebFetch',
  task: 'TodoWrite',
  subagent: 'Task',
  mcp: 'mcp__server__tool',
};

function toEntry(activity: Activity): TranscriptEntry {
  const tool = TOOL_NAMES[activity.kind];
  const text = activityText(activity);
  const detail = activityDetail(activity);
  if (tool) {
    return {
      kind: 'tool',
      at: activity.at,
      id: activity.id,
      name: tool,
      summary: `${activity.icon} ${activity.text}`,
      icon: activity.icon,
      summaryMsg: activity.msg,
      input: detail ? { detail } : undefined,
      result: activityDetail(activity) ?? t('mock.toolDone'),
      error: activity.error,
    };
  }
  switch (activity.kind) {
    case 'prompt':
      return { kind: 'user', at: activity.at, text: detail ?? text };
    case 'think':
      return { kind: 'thinking', at: activity.at, text: detail ?? text };
    case 'reply':
      return { kind: 'assistant', at: activity.at, text: detail ?? text };
    default:
      return { kind: 'system', at: activity.at, text: activity.text, msg: activity.msg };
  }
}

/** Accumulates the activities seen in snapshots so the mock transcript grows like a real one. */
export class MockLog {
  private readonly byAgent = new Map<string, Map<string, Activity>>();

  observe(snapshot: OfficeSnapshot): void {
    for (const agent of snapshot.agents) {
      let log = this.byAgent.get(agent.id);
      if (!log) {
        log = new Map();
        this.byAgent.set(agent.id, log);
      }
      for (const activity of agent.recent) log.set(activity.id, activity);
      if (agent.activity) log.set(agent.activity.id, agent.activity);
    }
  }

  activities(agentId: string): Activity[] {
    return [...(this.byAgent.get(agentId)?.values() ?? [])].sort((a, b) => a.at - b.at);
  }

  transcript(agent: Agent | undefined, after: number): TranscriptPage {
    const head: TranscriptEntry[] = agent
      ? [{ kind: 'user', at: agent.startedAt, text: agentTitle(agent) ?? t('mock.resumeWork') }]
      : [];
    const entries = [...head, ...(agent ? this.activities(agent.id).map(toEntry) : [])];
    return {
      entries: entries.slice(Math.max(0, after)),
      next: entries.length,
      title: agent?.title,
      open: agent !== undefined,
    };
  }
}

const HOUR_MS = 3_600_000;

export function mockSessions(snapshot: OfficeSnapshot, now: number): RecentSession[] {
  const open: RecentSession[] = snapshot.agents
    .filter((agent) => agent.kind === 'main')
    .map((agent) => {
      const project = snapshot.projects.find((candidate) => candidate.id === agent.projectId);
      return {
        accountId: agent.accountId,
        sessionId: agent.sessionId,
        projectPath: project?.path ?? agent.projectId,
        projectName: project?.name ?? t('mock.project'),
        title: agent.title,
        titleMsg: agent.titleMsg,
        firstAt: agent.startedAt,
        lastAt: agent.lastEventAt,
        open: true,
        agentId: agent.id,
      };
    });
  const accountId = snapshot.accounts[0]?.id ?? 'demo';
  const closedTitles = ['mock.session.checkout', 'mock.session.contact', 'mock.session.dependencies'] as const;
  const closed: RecentSession[] = ['api-pagamentos', 'site-institucional', 'app-mobile'].map((name, index) => ({
    accountId,
    sessionId: `mock-closed-${index}`,
    projectPath: `/demo/${name}`,
    projectName: name,
    title: t(closedTitles[index]),
    titleMsg: uiMsg(closedTitles[index]),
    firstAt: now - (index + 1) * 20 * HOUR_MS,
    lastAt: now - (index + 1) * 20 * HOUR_MS + 2 * HOUR_MS,
    open: false,
  }));
  return [...open, ...closed];
}

export function mockDay(snapshot: OfficeSnapshot, date: string): DayStats {
  return {
    date,
    agents: snapshot.agents.map((agent) => {
      const base = Math.abs(agent.seed) % 97;
      return {
        agentId: agent.id,
        name: agent.name,
        projectId: agent.projectId,
        ms: {
          working: (40 + base) * 60_000,
          waiting: (3 + (base % 11)) * 60_000,
          idle: (25 + (base % 41)) * 60_000,
          done: 0,
          offline: 0,
        },
      };
    }),
  };
}
