// What the demo office has customized: a few renamed and restyled agents and rooms, so the demo shows what
// personalization looks like. It is applied like a person's own customization (which then goes on top of it).
import type { Agent, Project } from '../model';
import { applyCustomization } from '../customization/apply';
import { type Customization, emptyCustomization } from '../customization/types';

/** The customization of the demo's first three rooms and their first agents (by position, whatever their ids). */
export function demoCustomization(projects: readonly Project[], agents: readonly Agent[]): Customization {
  const custom = emptyCustomization();
  const [first, second, third] = [...projects].sort((a, b) => a.order - b.order);
  const firstMain = (project: Project | undefined): Agent | undefined =>
    project === undefined ? undefined : agents.find((agent) => agent.projectId === project.id && agent.kind === 'main');
  if (first !== undefined)
    custom.rooms[first.id] = {
      alias: 'Checkout HQ',
      theme: { color: '#27b5c4', floor: 'wood', wall: 'brick', plants: 'lush', sign: 'neon' },
      look: { outfit: 'teal' },
    };
  if (second !== undefined)
    custom.rooms[second.id] = {
      theme: { color: '#e9853b', floor: 'concrete', wall: 'concrete', plants: 'few', sign: 'wood' },
    };
  if (third !== undefined)
    custom.rooms[third.id] = { theme: { color: '#9a65e0', floor: 'carpet', wall: 'plaster', sign: 'minimal' } };
  const looks: [Agent | undefined, NonNullable<Customization['agents'][string]>][] = [
    [firstMain(first), { name: 'Nova', look: { accessory: 'headphones', hairColor: 'red', hairStyle: 2 } }],
    [firstMain(second), { name: 'Pixel', look: { accessory: 'cap', outfit: 'crimson', skin: 'deep' } }],
    [firstMain(third), { look: { accessory: 'glasses', hairColor: 'blond', skin: 'fair' } }],
  ];
  for (const [agent, entry] of looks) if (agent !== undefined) custom.agents[agent.id] = entry;
  return custom;
}

/** The demo's agents and rooms with that customization on them. */
export function customizedDemo(projects: Project[], agents: Agent[]): { projects: Project[]; agents: Agent[] } {
  return applyCustomization({ projects, agents }, demoCustomization(projects, agents));
}
