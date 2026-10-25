import { describe, expect, it } from 'vitest';
import { createDemoSimulator } from './simulator';

describe('the customized demo', () => {
  const T0 = 1_800_000_000_000;
  const sim = createDemoSimulator({ seed: 1, now: () => T0 });
  const snapshot = sim.snapshot(T0);

  it('shows rooms with an alias and finishes of their own', () => {
    const [first, second, third] = snapshot.projects;
    expect(first).toMatchObject({
      name: 'Checkout HQ',
      originalName: 'loja-online',
      theme: { floor: 'wood', wall: 'brick', sign: 'neon' },
    });
    expect(second?.theme).toMatchObject({ floor: 'concrete', plants: 'few' });
    expect(third?.theme).toMatchObject({ wall: 'plaster', sign: 'minimal' });
  });

  it('shows renamed agents and agents with an accessory', () => {
    const named = snapshot.agents.filter((agent) => agent.defaultName !== undefined).map((agent) => agent.name);
    expect(named.sort()).toEqual(['Nova', 'Pixel']);
    const accessories = snapshot.agents.flatMap((agent) =>
      agent.appearance?.accessory ? [agent.appearance.accessory] : [],
    );
    expect(accessories.sort()).toEqual(['cap', 'glasses', 'headphones']);
  });

  it('dresses the team of the first room in its color, subagents included', () => {
    const room = snapshot.projects[0]?.id;
    const team = snapshot.agents.filter((agent) => agent.projectId === room);
    expect(team.length).toBeGreaterThan(0);
    for (const agent of team) expect(agent.appearance?.outfit).toBe('teal');
  });

  it('leaves the agents a person asks about with the same ids and the same state', () => {
    expect(sim.agents().map((agent) => agent.id)).toEqual(snapshot.agents.map((agent) => agent.id));
  });
});
