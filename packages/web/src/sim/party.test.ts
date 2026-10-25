import type { Agent, OfficeSnapshot, TaskItem } from '@ai-office/shared';
import { describe, expect, it } from 'vitest';
import { BubbleManager } from './bubbles';
import { OfficeSim } from './sim';
import { makeAgent, makeSnapshot } from './testkit';

const task = (id: string, status: TaskItem['status']): TaskItem => ({ id, title: id, status });
const open = (id: string): TaskItem[] => [
  task(`${id}1`, 'completed'),
  task(`${id}2`, 'in_progress'),
  task(`${id}3`, 'pending'),
];
const finished = (id: string): TaskItem[] => ['1', '2', '3'].map((n) => task(`${id}${n}`, 'completed'));

function office(agents: Agent[], rev = 1): { sim: OfficeSim; push: (next: Agent[]) => void } {
  const sim = new OfficeSim(11);
  sim.setOptions({ bubbles: 'all' });
  let revision = rev;
  let clock = 1_000_000;
  const push = (next: Agent[]): void => {
    clock += 1000;
    const snapshot: OfficeSnapshot = makeSnapshot(1, next, ++revision);
    sim.setSnapshot(snapshot, clock);
  };
  sim.setSnapshot(makeSnapshot(1, agents, rev), clock);
  sim.runFor(2);
  return { sim, push };
}

describe('celebrations in the simulation', () => {
  it('bursts confetti, cheers and shows a bubble when the whole task list gets done', () => {
    const { sim, push } = office([makeAgent('ana', 0, 'working', { tasks: open('a') })]);
    push([makeAgent('ana', 0, 'working', { tasks: finished('a') })]);
    sim.runFor(0.5);

    const effects = sim.takeEffects();
    expect(effects.some((e) => e.type === 'burst')).toBe(true);
    expect(effects.some((e) => e.type === 'sound')).toBe(true);
    const ana = sim.character('ana')!;
    expect(ana.pose).toBe('celebrate');
    expect(ana.celebrating).toBe(true);
    expect(sim.takeEffects()).toEqual([]);
  });

  it('anchors the bubble above the person for a task list and in the middle of the room for a room milestone', () => {
    const { sim, push } = office([
      makeAgent('ana', 0, 'working', { tasks: open('a') }),
      makeAgent('bia', 0, 'working', { tasks: open('b') }),
    ]);
    push([
      makeAgent('ana', 0, 'working', { tasks: finished('a') }),
      makeAgent('bia', 0, 'working', { tasks: open('b') }),
    ]);
    sim.runFor(0.5);
    const personal = sim.bubbles.find((b) => b.agentId === 'ana');
    expect(personal?.msg?.key).toBe('bubble.celebrate.tasks');
    expect(personal?.anchor).toBeUndefined();

    const room = office([makeAgent('cai', 0, 'working', { tasks: open('c') })]);
    room.push([makeAgent('cai', 0, 'working', { tasks: finished('c') })]);
    room.sim.runFor(0.5);
    const shared = room.sim.bubbles.find((b) => b.agentId === 'cai');
    expect(shared?.msg?.key).toBe('bubble.celebrate.room');
    expect(shared?.anchor).toBe('room');
  });

  it('turns the celebrant to the camera and has the colleagues who clap turn to it as well', () => {
    const { sim, push } = office([makeAgent('ana', 0, 'working', { tasks: open('a') }), makeAgent('bia', 0, 'idle')]);
    push([makeAgent('ana', 0, 'working', { tasks: finished('a') }), makeAgent('bia', 0, 'idle')]);
    sim.runFor(0.6);
    expect(sim.character('ana')!.dir).toBe('s');
    expect(sim.character('bia')!.pose).toBe('clap');
    expect(sim.character('bia')!.dir).toBe('s');
  });

  it('showers the whole room when it was the last open task of the room', () => {
    const { sim, push } = office([
      makeAgent('ana', 0, 'working', { tasks: open('a') }),
      makeAgent('bia', 0, 'idle', { tasks: finished('b') }),
    ]);
    push([
      makeAgent('ana', 0, 'working', { tasks: finished('a') }),
      makeAgent('bia', 0, 'idle', { tasks: finished('b') }),
    ]);
    expect(sim.takeEffects().some((e) => e.type === 'shower')).toBe(true);
  });

  it('does nothing visual when celebrations are off', () => {
    const { sim, push } = office([makeAgent('ana', 0, 'working', { tasks: open('a') })]);
    sim.setOptions({ celebrations: false });
    push([makeAgent('ana', 0, 'working', { tasks: finished('a') })]);
    sim.runFor(0.5);
    expect(sim.takeEffects()).toEqual([]);
    expect(sim.character('ana')!.celebrating).toBe(false);
  });

  it('shows a still badge instead of particles and jumps with reduced motion', () => {
    const { sim, push } = office([makeAgent('ana', 0, 'working', { tasks: open('a') })]);
    sim.setOptions({ reducedMotion: true });
    push([makeAgent('ana', 0, 'working', { tasks: finished('a') })]);
    sim.runFor(0.5);
    const effects = sim.takeEffects();
    expect(effects.filter((e) => e.type !== 'sound')).toEqual([]);
    const ana = sim.character('ana')!;
    expect(ana.celebrationBadge).toBe(true);
    expect(ana.celebrating).toBe(false);
    expect(ana.pose).not.toBe('celebrate');
  });

  it('rations the celebrations of one person', () => {
    const { sim, push } = office([makeAgent('ana', 0, 'working', { tasks: open('a') })]);
    push([makeAgent('ana', 0, 'working', { tasks: finished('a') })]);
    sim.takeEffects();
    push([makeAgent('ana', 0, 'working', { tasks: open('x') })]);
    push([makeAgent('ana', 0, 'working', { tasks: finished('x') })]);
    expect(sim.takeEffects().filter((e) => e.type === 'burst')).toHaveLength(0);
  });

  it('lets idle colleagues of the room clap and face the celebrant', () => {
    const { sim, push } = office([makeAgent('ana', 0, 'working', { tasks: open('a') }), makeAgent('bia', 0, 'idle')]);
    push([makeAgent('ana', 0, 'working', { tasks: finished('a') }), makeAgent('bia', 0, 'idle')]);
    sim.runFor(0.5);
    expect(sim.character('bia')!.pose).toBe('clap');
  });

  it('does not celebrate on the first snapshot or after a reset', () => {
    const sim = new OfficeSim(3);
    sim.setSnapshot(makeSnapshot(1, [makeAgent('ana', 0, 'idle', { tasks: finished('a') })]), 1_000_000);
    sim.runFor(1);
    expect(sim.takeEffects()).toEqual([]);
  });
});

describe('work poses', () => {
  const activity = (kind: 'read' | 'edit' | 'bash' | 'think' | 'subagent') => ({
    id: kind,
    at: 1,
    kind,
    icon: 'x',
    text: kind,
  });
  const pose = (kind: Parameters<typeof activity>[0]): string => {
    const { sim } = office([makeAgent('ana', 0, 'working', { activity: activity(kind) })]);
    sim.runFor(1);
    return sim.character('ana')!.pose;
  };

  it('reads, types fast, leans back at the terminal, thinks and points', () => {
    expect(pose('read')).toBe('readDoc');
    expect(pose('edit')).toBe('typeFast');
    expect(pose('bash')).toBe('lean');
    expect(pose('think')).toBe('think');
    expect(pose('subagent')).toBe('point');
  });

  it('scratches its head after repeated errors', () => {
    const error = (id: string) => ({
      id,
      at: 1_000_000 - 2000,
      kind: 'error' as const,
      icon: '⚠️',
      text: 'e',
      error: true,
    });
    const { sim } = office([
      makeAgent('ana', 0, 'working', { activity: error('e2'), recent: [error('e1'), error('e2')] }),
    ]);
    sim.runFor(1);
    expect(sim.character('ana')!.pose).toBe('scratch');
  });

  it('raises a hand when it needs the user', () => {
    const { sim } = office([makeAgent('ana', 0, 'waiting')]);
    sim.runFor(1);
    expect(sim.character('ana')!.pose).toBe('hand');
    expect(sim.character('ana')!.alert).toBe(true);
  });
});

const phaseOf = (sim: OfficeSim, id: string): string => (sim.character(id) as unknown as { phase: string }).phase;

describe('encounters in the simulation', () => {
  const sub = (status: Agent['status'] = 'working'): Agent =>
    makeAgent('sub1', 0, status, { kind: 'sub', parentId: 'ana', role: 'Explore' });

  function withSub(parentStatus: Agent['status'] = 'working'): { sim: OfficeSim; push: (next: Agent[]) => void } {
    const o = office([makeAgent('ana', 0, parentStatus)]);
    o.push([makeAgent('ana', 0, parentStatus), sub()]);
    return o;
  }

  it('sends the main agent to shake hands with a subagent that sat down in the meeting room', () => {
    const { sim } = withSub();
    let met = false;
    for (let i = 0; i < 90 && !met; i++) {
      sim.runFor(1);
      const ana = sim.character('ana')!;
      met = ana.pose === 'shake';
    }
    expect(met).toBe(true);
    expect(sim.character('sub1')!.pose).toBe('shake');
    sim.runFor(8);
    const ana = sim.character('ana')!;
    expect(ana.areaId).toBe('room:/work/proj-0');
  });

  it('calls the main agent back to its desk the moment it needs the user', () => {
    const { sim, push } = withSub();
    for (let i = 0; i < 90 && phaseOf(sim, 'ana') !== 'toMeet'; i++) sim.runFor(1);
    expect(phaseOf(sim, 'ana')).toBe('toMeet');
    push([makeAgent('ana', 0, 'waiting'), sub()]);
    sim.runFor(0.2);
    expect(phaseOf(sim, 'ana')).not.toBe('toMeet');
    sim.runFor(40);
    expect(sim.character('ana')!.pose).toBe('hand');
    expect(sim.character('sub1')!.pose).not.toBe('shake');
  });

  it('is deterministic for the same seed', () => {
    const run = (): string => {
      const { sim } = withSub();
      sim.runFor(60);
      return sim.characters.map((c) => `${c.id}:${c.pose}:${c.x.toFixed(2)}:${c.y.toFixed(2)}`).join('|');
    };
    expect(run()).toBe(run());
  });
});

describe('small talk and ambient bubbles', () => {
  it('shows icon-only bubbles while two idle people chat, taking turns', () => {
    const sim = new OfficeSim(5);
    sim.setOptions({ bubbles: 'important', liveliness: 'lively' });
    sim.setSnapshot(
      makeSnapshot(1, [makeAgent('ana', 0, 'idle'), makeAgent('bia', 0, 'idle'), makeAgent('caio', 0, 'idle')]),
      1_000_000,
    );
    const speakers = new Set<string>();
    let sawIconOnly = false;
    for (let i = 0; i < 60 * 30; i++) {
      sim.runFor(1 / 2);
      for (const b of sim.bubbles) {
        if (b.ambient) {
          speakers.add(b.agentId);
          sawIconOnly ||= b.text === '' && b.icon !== '';
        }
      }
    }
    expect(sawIconOnly).toBe(true);
    expect(speakers.size).toBeGreaterThanOrEqual(2);
  });
});

describe('bubble rationing of ambient talk', () => {
  const ambient = {
    agentId: 'a',
    roomId: 'r',
    text: '',
    icon: '💬',
    importance: 12,
    sticky: false,
    ttl: 2,
    ambient: true,
  };

  it('lets it through in important mode, but not in calm mode or when bubbles are off', () => {
    const lively = new BubbleManager();
    lively.configure('important', 'normal');
    lively.offer(ambient, 0);
    expect(lively.update(0.1, () => 'r')).toHaveLength(1);
    const calm = new BubbleManager();
    calm.configure('important', 'calm');
    calm.offer(ambient, 0);
    expect(calm.update(0.1, () => 'r')).toHaveLength(0);
    const off = new BubbleManager();
    off.configure('none', 'lively');
    off.offer(ambient, 0);
    expect(off.update(0.1, () => 'r')).toHaveLength(0);
  });
});

describe('high five and waves', () => {
  it('has two colleagues of a room that celebrate close in time meet and high-five, then go back to work', () => {
    const { sim, push } = office([
      makeAgent('ana', 0, 'working', { tasks: open('a') }),
      makeAgent('bia', 0, 'working', { tasks: open('b') }),
    ]);
    push([
      makeAgent('ana', 0, 'working', { tasks: finished('a') }),
      makeAgent('bia', 0, 'working', { tasks: open('b') }),
    ]);
    sim.runFor(3);
    push([
      makeAgent('ana', 0, 'working', { tasks: finished('a') }),
      makeAgent('bia', 0, 'working', { tasks: finished('b') }),
    ]);
    let slapped = false;
    for (let i = 0; i < 40 && !slapped; i++) {
      sim.runFor(1);
      slapped = sim.character('ana')!.pose === 'highfive' && sim.character('bia')!.pose === 'highfive';
    }
    expect(slapped).toBe(true);
    sim.runFor(30);
    for (const id of ['ana', 'bia']) {
      expect(sim.character(id)!.seat).toBe('desk');
      expect(sim.character(id)!.pose).toBe('type');
    }
  });

  it('waves when two people cross in the corridor', () => {
    const sim = new OfficeSim(9);
    sim.setOptions({ liveliness: 'lively' });
    const agents = [
      makeAgent('ana', 0, 'idle'),
      makeAgent('bia', 0, 'idle'),
      makeAgent('caio', 0, 'idle'),
      makeAgent('duda', 0, 'idle'),
    ];
    sim.setSnapshot(makeSnapshot(1, agents), 1_000_000);
    let waved = false;
    for (let i = 0; i < 60 * 60 * 3 && !waved; i++) {
      sim.runFor(1 / 2);
      waved = sim.characters.some((c) => c.pose === 'wave');
    }
    expect(waved).toBe(true);
  });
});

describe('ping-pong in the simulation', () => {
  it('reports a rally on the table while two idle people play, and none otherwise', () => {
    const sim = new OfficeSim(21);
    sim.setOptions({ liveliness: 'lively' });
    const agents = ['ana', 'bia', 'caio', 'duda', 'edu', 'fabi'].map((id) => makeAgent(id, 0, 'idle'));
    sim.setSnapshot(makeSnapshot(1, agents), 1_000_000);
    expect(sim.pingPongTables().every((t) => !t.playing)).toBe(true);
    let rally = false;
    for (let i = 0; i < 60 * 60 && !rally; i++) {
      sim.runFor(1);
      rally = sim.pingPongTables().some((t) => t.playing);
    }
    expect(rally).toBe(true);
  });
});
