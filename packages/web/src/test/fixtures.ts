// Synthetic builders for tests (never real data).
import type { Account, Activity, Agent, OfficeSnapshot, PermissionRequest, Project } from '@ai-office/shared';

export function activity(over: Partial<Activity> = {}): Activity {
  return { id: 'a1', at: 1_000, kind: 'read', icon: '📖', text: 'Lendo App.tsx', ...over };
}

export function agent(over: Partial<Agent> = {}): Agent {
  return {
    id: 'ag1',
    kind: 'main',
    sessionId: 's1',
    accountId: 'acc1',
    projectId: 'p1',
    name: 'Ana',
    role: 'Principal',
    look: 'f',
    seed: 42,
    status: 'working',
    statusSince: 1_000,
    recent: [],
    tasks: [],
    shells: [],
    stats: { toolCalls: 0, tokensIn: 0, tokensOut: 0, linesAdded: 0, linesRemoved: 0, subagents: 0 },
    startedAt: 0,
    lastEventAt: 0,
    ...over,
  };
}

export function permission(over: Partial<PermissionRequest> = {}): PermissionRequest {
  return { id: 'perm1', agentId: 'ag1', toolName: 'Bash', summary: 'npm test', input: { command: 'npm test' }, suggestions: [], createdAt: 1_000, expiresAt: 61_000, ...over };
}

export function project(over: Partial<Project> = {}): Project {
  return { id: 'p1', name: 'loja', path: '/demo/loja', seed: 7, order: 0, ...over };
}

export function account(over: Partial<Account> = {}): Account {
  return { id: 'acc1', label: 'Pessoal', initial: 'P', color: '#2f6fed', dir: '/demo/.claude', ...over };
}

export function snapshot(over: Partial<OfficeSnapshot> = {}): OfficeSnapshot {
  return {
    rev: 1,
    serverTime: 10_000,
    meta: { version: '0.1.0', startedAt: 1, local: true, demo: false },
    accounts: [account()],
    projects: [project()],
    agents: [agent()],
    usage: [],
    ...over,
  };
}
