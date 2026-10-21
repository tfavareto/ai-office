// Which rooms the git watcher follows: the real ones (the demo's rooms are fiction), and how busy each one is.
import type { Agent, Project } from '@ai-office/shared';
import type { WatchedProject } from './watcher';

export function watchedRooms(projects: readonly Project[], agents: readonly Agent[], simulatedIds: ReadonlySet<string>): WatchedProject[] {
  const active = new Set<string>();
  for (const agent of agents) if (agent.demo !== true && (agent.status === 'working' || agent.status === 'waiting')) active.add(agent.projectId);
  return projects.filter((project) => !simulatedIds.has(project.id)).map((project) => ({ id: project.id, path: project.path, active: active.has(project.id) }));
}
