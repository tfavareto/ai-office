// Puts a customization on top of what the office computed: names, resolved looks, room names and finishes, and the
// flags the page uses to arrange the building. Pure: it returns new objects only for what changed.
import type { Agent, Project } from '../model';
import { lookLayers, resolveLook } from './resolve';
import type { Customization } from './types';

export interface CustomizableOffice {
  projects: Project[];
  agents: Agent[];
}

function applyToProject(project: Project, customization: Customization): Project {
  const room = customization.rooms[project.id];
  const rank = customization.order.indexOf(project.id);
  if (room === undefined && rank < 0) return project;
  return {
    ...project,
    ...(room?.alias !== undefined ? { name: room.alias, originalName: project.name } : {}),
    ...(room?.theme !== undefined ? { theme: { ...project.theme, ...room.theme } } : {}),
    ...(room?.pinned === true ? { pinned: true } : {}),
    ...(room?.hidden === true ? { hidden: true } : {}),
    ...(rank >= 0 ? { rank } : {}),
  };
}

function applyToAgent(agent: Agent, parent: Agent | undefined, customization: Customization): Agent {
  const own = customization.agents[agent.id];
  // A subagent wears what its main agent's room and account give: the team's colors.
  const team = parent ?? agent;
  const appearance = resolveLook(lookLayers(customization, agent.id, team.projectId, team.accountId));
  if (own?.name === undefined && appearance === undefined) return agent;
  return {
    ...agent,
    ...(own?.name !== undefined ? { name: own.name, defaultName: agent.name } : {}),
    ...(appearance !== undefined ? { appearance: { ...agent.appearance, ...appearance } } : {}),
  };
}

export function applyCustomization(office: CustomizableOffice, customization: Customization): CustomizableOffice {
  const isEmpty =
    Object.keys(customization.agents).length === 0 &&
    Object.keys(customization.rooms).length === 0 &&
    Object.keys(customization.accounts).length === 0 &&
    customization.order.length === 0;
  if (isEmpty) return office;
  const byId = new Map(office.agents.map((agent) => [agent.id, agent]));
  return {
    projects: office.projects.map((project) => applyToProject(project, customization)),
    agents: office.agents.map((agent) =>
      applyToAgent(agent, agent.parentId === undefined ? undefined : byId.get(agent.parentId), customization),
    ),
  };
}
