// Agents being hired are drawn as placeholder people: a person walks in, sits at the chosen desk and waits there until
// the real session shows up and takes the placeholder over. These helpers turn the snapshot's pending hires into what
// the simulation needs (a placeholder agent, a room when the folder has none yet).
import { type Agent, type PendingHire, type Project, fnv1a, pickName } from '@ai-office/shared';

const HIRE_AGENT_PREFIX = 'hire:';

export const hireAgentId = (hireId: string): string => `${HIRE_AGENT_PREFIX}${hireId}`;

export const isHireAgentId = (agentId: string): boolean => agentId.startsWith(HIRE_AGENT_PREFIX);

/** Hires whose session has not appeared yet (the ones that still have a placeholder person). */
export function waitingHires(hires: readonly PendingHire[] | undefined): PendingHire[] {
  return (hires ?? []).filter((hire) => hire.agentId === undefined);
}

/** The person standing in for a pending hire. Idle, so it sits quietly; the real data replaces it on handover. */
export function placeholderAgent(hire: PendingHire): Agent {
  const person = pickName(hire.id, new Set());
  return {
    id: hireAgentId(hire.id),
    kind: 'main',
    sessionId: hireAgentId(hire.id),
    accountId: hire.accountId,
    projectId: hire.projectId,
    name: person.name,
    role: '',
    look: person.look,
    seed: fnv1a(hire.id),
    status: 'idle',
    statusSince: hire.createdAt,
    recent: [],
    tasks: [],
    shells: [],
    stats: { toolCalls: 0, tokensIn: 0, tokensOut: 0, linesAdded: 0, linesRemoved: 0, subagents: 0 },
    startedAt: hire.createdAt,
    lastEventAt: hire.createdAt,
  };
}

/** The projects plus a room for every pending hire into a folder that has none (same seed as the real room will have). */
export function withHireProjects(projects: readonly Project[], hires: readonly PendingHire[]): Project[] {
  const known = new Set(projects.map((project) => project.id));
  let order = projects.reduce((max, project) => Math.max(max, project.order + 1), 0);
  const extra: Project[] = [];
  for (const hire of hires) {
    if (known.has(hire.projectId)) continue;
    known.add(hire.projectId);
    extra.push({
      id: hire.projectId,
      name: hire.projectId.split('/').filter(Boolean).pop() ?? hire.projectId,
      path: hire.projectId,
      seed: fnv1a(hire.projectId),
      order: order++,
    });
  }
  return extra.length === 0 ? [...projects] : [...projects, ...extra];
}
