// Puts two time-lapses of the same day side by side (the real office and the demo one): the second one's agents and
// projects follow the first one's, and its events are renumbered to match.
import { sortEvents } from './order';
import type { Timelapse, TimelapseEvent } from './types';

function shifted(event: TimelapseEvent, agents: number, projects: number): TimelapseEvent {
  if (event.type === 'commit') return { ...event, project: event.project + projects, ...(event.agent !== undefined ? { agent: event.agent + agents } : {}) };
  return { ...event, agent: event.agent + agents };
}

function bound(pick: (value: number, other: number) => number, a: number | undefined, b: number | undefined): number | undefined {
  return a === undefined ? b : b === undefined ? a : pick(a, b);
}

export function mergeTimelapses(first: Timelapse, second: Timelapse): Timelapse {
  if (second.agents.length === 0) return first;
  if (first.agents.length === 0) return { ...second, truncated: first.truncated ?? second.truncated, ...(first.demo === true ? { demo: true } : {}) };
  const from = bound(Math.min, first.from, second.from);
  const to = bound(Math.max, first.to, second.to);
  const projects = [...first.projects, ...second.projects.map((project) => ({ ...project, order: project.order + first.projects.length }))];
  const agents = [...first.agents, ...second.agents];
  const events = sortEvents([...first.events, ...second.events.map((event) => shifted(event, first.agents.length, first.projects.length))]);
  return {
    ...first,
    ...(from !== undefined ? { from } : {}),
    ...(to !== undefined ? { to } : {}),
    projects,
    agents,
    events,
    ...(second.demo === true ? { demo: true } : {}),
  };
}
