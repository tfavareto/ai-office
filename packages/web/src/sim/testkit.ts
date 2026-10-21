import type { Agent, AgentStatus, OfficeSnapshot, Project } from '@ai-office/shared';

/** Synthetic fixtures for simulation tests and the dev harness. */
export function makeProject(i: number): Project {
  return { id: `/work/proj-${i}`, name: `proj-${i}`, path: `/work/proj-${i}`, seed: 1000 + i * 7919, order: i };
}

export function makeAgent(
  id: string,
  projectIndex: number,
  status: AgentStatus = 'working',
  over: Partial<Agent> = {},
): Agent {
  return {
    id,
    kind: 'main',
    sessionId: `s-${id}`,
    accountId: 'a1',
    projectId: makeProject(projectIndex).id,
    name: id,
    role: 'Principal',
    look: id.length % 2 === 0 ? 'f' : 'm',
    seed: 1 + [...id].reduce((n, c) => n * 31 + c.charCodeAt(0), 7),
    status,
    statusSince: 0,
    recent: [],
    tasks: [],
    shells: [],
    stats: { toolCalls: 0, tokensIn: 0, tokensOut: 0, linesAdded: 0, linesRemoved: 0, subagents: 0 },
    startedAt: 0,
    lastEventAt: 0,
    ...over,
  };
}

export function makeSnapshot(projects: number, agents: Agent[], rev = 1): OfficeSnapshot {
  return {
    rev,
    serverTime: 1_000_000,
    meta: { version: 'test', startedAt: 0, local: true, demo: true },
    accounts: [{ id: 'a1', label: 'Pessoal', initial: 'P', color: '#4f86f7', dir: '/tmp/a1' }],
    projects: Array.from({ length: projects }, (_, i) => makeProject(i)),
    agents,
    usage: [],
  };
}
