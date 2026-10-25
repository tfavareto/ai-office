import { describe, expect, test } from 'vitest';
import { fnv1a, mulberry32 } from '../hash';
import { ALWAYS_ABSENT, MARK, fakeAgent, fakeProject, randomOffice } from './fixtures';
import { buildTeamShare, flatMsg } from './sanitize';
import { DEFAULT_TEAM_SHARE, SHARE_CATEGORIES, TEAM_MAX_AGENTS, TEAM_MAX_ROOMS, type TeamSharePrefs } from './types';
import { parseTeamShare } from './validate';

const NOW = 1_000_000;
const key_ = (kind: 'agent' | 'room', id: string): string =>
  `${kind[0]}${fnv1a(`${kind}:${id}`).toString(16).padStart(8, '0')}`;
const key = (kind: string, id: string): string => `${kind[0]}${fnv1a(`${kind}:${id}`).toString(16).padStart(8, '0')}`;
const SEEDS = Array.from({ length: 200 }, (_, i) => i + 1);

function share(seed: number, prefs: Partial<TeamSharePrefs> = {}): string {
  return JSON.stringify(buildTeamShare(randomOffice(seed), { ...DEFAULT_TEAM_SHARE, ...prefs }, NOW, key));
}

describe('buildTeamShare: defaults', () => {
  test('no forbidden marker ever appears over 200 random offices', () => {
    for (const seed of SEEDS) {
      const text = share(seed);
      for (const marker of ALWAYS_ABSENT) expect(text, `seed ${seed}`).not.toContain(marker);
      for (const marker of [MARK.alias, MARK.prompt, MARK.file, MARK.branch, String(MARK.tokens)])
        expect(text, `seed ${seed}`).not.toContain(marker);
      expect(text).not.toContain('3.14159');
    }
  });

  test('rooms are numbered from 1 in the order of arrival and carry no name', () => {
    const office = { projects: [fakeProject(2), fakeProject(0), fakeProject(1)], agents: [] as never[] };
    const rng = mulberry32(1);
    const agents = office.projects.map((project, i) => ({
      ...fakeAgent(i, project.id, rng, NOW),
      status: 'working' as const,
    }));

    const result = buildTeamShare({ ...office, agents }, DEFAULT_TEAM_SHARE, NOW, key);

    expect(result.rooms.map((room) => room.index)).toEqual([1, 2, 3]);
    expect(result.rooms.every((room) => room.name === undefined)).toBe(true);
  });

  test('only working, waiting and idle agents are shared, with an age and no wall-clock time', () => {
    for (const seed of SEEDS.slice(0, 40)) {
      const result = buildTeamShare(randomOffice(seed), DEFAULT_TEAM_SHARE, NOW, key);
      for (const agent of result.agents) {
        expect(['working', 'waiting', 'idle']).toContain(agent.status);
        expect(agent.sinceAgeMs).toBeGreaterThanOrEqual(0);
        expect(agent.sinceAgeMs).toBeLessThan(700_000);
        expect(Object.keys(agent).sort()).toEqual(
          ['activityKind', 'key', 'kind', 'look', 'name', 'roomKey', 'sinceAgeMs', 'status'].sort(),
        );
      }
    }
  });

  test('the personalized name and look are shared, the original folder name behind an alias never', () => {
    const rng = mulberry32(3);
    const project = { ...fakeProject(0), name: 'Meu Time', originalName: MARK.folder };
    const agent = {
      ...fakeAgent(0, project.id, rng, NOW),
      status: 'idle' as const,
      name: 'Capitã Ana',
      defaultName: 'Bia',
      appearance: { outfit: 'blue' } as never,
    };

    const text = JSON.stringify(buildTeamShare({ projects: [project], agents: [agent] }, DEFAULT_TEAM_SHARE, NOW, key));

    expect(text).toContain('Capitã Ana');
    expect(text).not.toContain('Bia');
    expect(text).not.toContain(MARK.folder);
    expect(text).not.toContain('Meu Time');
  });

  test('a paused share is empty and says so', () => {
    expect(buildTeamShare(randomOffice(5), { ...DEFAULT_TEAM_SHARE, paused: true }, NOW, key)).toEqual({
      rooms: [],
      agents: [],
      paused: true,
    });
  });

  test('the caps hold for any office', () => {
    for (const seed of SEEDS) {
      const result = buildTeamShare(randomOffice(seed), DEFAULT_TEAM_SHARE, NOW, key);
      expect(result.agents.length).toBeLessThanOrEqual(TEAM_MAX_AGENTS);
      expect(result.rooms.length).toBeLessThanOrEqual(TEAM_MAX_ROOMS);
      const rooms = new Set(result.rooms.map((room) => room.key));
      expect(result.agents.every((agent) => rooms.has(agent.roomKey))).toBe(true);
    }
  });
});

describe('buildTeamShare: opt-in categories', () => {
  const EXPECTED: Record<(typeof SHARE_CATEGORIES)[number], string[]> = {
    projectNames: [MARK.alias],
    activityText: [MARK.file],
    titles: [MARK.prompt],
    branches: [MARK.branch],
    usage: [String(MARK.tokens), '3.1416'],
  };

  test.each(SHARE_CATEGORIES)('%s alone adds only its own data', (category) => {
    let seen = false;
    for (const seed of SEEDS) {
      const text = share(seed, { [category]: true });
      for (const marker of ALWAYS_ABSENT) expect(text, `seed ${seed}`).not.toContain(marker);
      for (const other of SHARE_CATEGORIES) {
        if (other === category) continue;
        for (const marker of EXPECTED[other]) expect(text, `${category} seed ${seed}`).not.toContain(marker);
      }
      if (EXPECTED[category].every((marker) => text.includes(marker))) seen = true;
    }
    expect(seen).toBe(true);
  });

  test('the folder name behind an alias stays private even with project names on', () => {
    for (const seed of SEEDS.slice(0, 30)) expect(share(seed, { projectNames: true })).not.toContain(MARK.folder);
  });

  test('all categories on still never leak identifiers, commands, tasks or permissions', () => {
    const all = Object.fromEntries(SHARE_CATEGORIES.map((category) => [category, true]));
    for (const seed of SEEDS) for (const marker of ALWAYS_ABSENT) expect(share(seed, all)).not.toContain(marker);
  });

  test('a command in the activity detail is never shared, even with the activity text on', () => {
    for (const seed of SEEDS.slice(0, 30)) expect(share(seed, { activityText: true })).not.toContain(MARK.command);
  });
});

describe('a share survives the strict reader unchanged', () => {
  test('parse(build(x)) equals build(x) for random offices and preferences', () => {
    const rng = mulberry32(99);
    for (const seed of SEEDS) {
      const prefs = { ...DEFAULT_TEAM_SHARE };
      for (const category of SHARE_CATEGORIES) prefs[category] = rng() < 0.5;
      const built = buildTeamShare(randomOffice(seed), prefs, NOW, key);
      expect(parseTeamShare(JSON.parse(JSON.stringify(built)))).toEqual(built);
    }
  });
});

describe('flatMsg', () => {
  test('keeps plain parameters and refuses nested messages and odd keys', () => {
    expect(flatMsg({ key: 'activity.read', params: { n: 2, file: 'x\u0007y' } })).toEqual({
      key: 'activity.read',
      params: { n: 2, file: 'x y' },
    });
    expect(flatMsg({ key: 'activity.read', params: { inner: { key: 'x' } } })).toBeUndefined();
    expect(flatMsg({ key: '../etc' })).toBeUndefined();
    expect(flatMsg('text')).toBeUndefined();
  });
});

describe('activity messages are a fixed whitelist', () => {
  const NOW_ = 1_000_000;
  const office = (activity: Record<string, unknown>): ReturnType<typeof randomOffice> => {
    const base = randomOffice(7, NOW_);
    const project = fakeProject(0);
    const agent = {
      ...fakeAgent(0, project.id, mulberry32(1), NOW_),
      status: 'working' as const,
      activity: { id: 'a', at: 1, icon: 'x', ...activity },
    };
    return { projects: [project], agents: [agent as never], ...(base ? {} : {}) };
  };
  const on = { ...DEFAULT_TEAM_SHARE, activityText: true };

  test('a catalog key outside the activity messages never leaves, even with the category on', () => {
    for (const key of [
      'settings.about',
      'constructor',
      '__proto__',
      'toString',
      'activity.prompt',
      'activity.message',
    ]) {
      const result = buildTeamShare(office({ kind: 'read', text: 'Lendo x', msg: { key } }), on, NOW_, key_);
      expect(result.agents[0]?.activityMsg, key).toBeUndefined();
    }
  });

  test('an activity message travels only with the category on', () => {
    const activity = { kind: 'read', text: 'Lendo a.ts', msg: { key: 'activity.read', params: { file: 'a.ts' } } };

    expect(buildTeamShare(office(activity), on, NOW_, key_).agents[0]?.activityMsg).toEqual(activity.msg);
    expect(buildTeamShare(office(activity), DEFAULT_TEAM_SHARE, NOW_, key_).agents[0]?.activityMsg).toBeUndefined();
  });

  test('what the person typed (a prompt, a message) is never shared as words', () => {
    for (const kind of ['prompt', 'message']) {
      const result = buildTeamShare(
        office({ kind, text: 'Nova tarefa: SEGREDO', msg: { key: 'activity.prompt', params: { prompt: 'SEGREDO' } } }),
        on,
        NOW_,
        key_,
      );
      expect(JSON.stringify(result), kind).not.toContain('SEGREDO');
    }
  });

  test('the host reader drops a message that is not on the list, or that comes without its words', () => {
    const room = { key: 'r1', index: 1 };
    const agent = { key: 'a1', name: 'Ana', roomKey: 'r1', kind: 'main', status: 'working', sinceAgeMs: 1, look: 'f' };
    const read = (extra: Record<string, unknown>) =>
      parseTeamShare({ rooms: [room], agents: [{ ...agent, ...extra }] })?.agents[0];

    expect(read({ activityText: 'x', activityMsg: { key: 'activity.read' } })?.activityMsg).toEqual({
      key: 'activity.read',
    });
    expect(read({ activityText: 'x', activityMsg: { key: 'constructor' } })?.activityMsg).toBeUndefined();
    expect(read({ activityText: 'x', activityMsg: { key: 'ui.anything' } })?.activityMsg).toBeUndefined();
    expect(read({ activityMsg: { key: 'activity.read' } })?.activityMsg).toBeUndefined();
  });
});

describe('what the sender rebuilds itself', () => {
  test('a look is rebuilt from valid fields only', () => {
    const project = fakeProject(0);
    const agent = {
      ...fakeAgent(0, project.id, mulberry32(2), NOW),
      status: 'idle' as const,
      appearance: { outfit: 'blue', secret: 'x', skin: 'not-a-skin' } as never,
    };

    const text = JSON.stringify(buildTeamShare({ projects: [project], agents: [agent] }, DEFAULT_TEAM_SHARE, NOW, key));

    expect(text).not.toContain('secret');
    expect(text).not.toContain('not-a-skin');
  });

  test('a room without an alias shows the last folder segment, with either kind of separator', () => {
    const prefs = { ...DEFAULT_TEAM_SHARE, projectNames: true };
    for (const name of ['/home/ana/repo/site', 'C:\\Users\\ana\\site']) {
      const project = { ...fakeProject(0), name };
      const bare = { ...project, originalName: undefined };
      delete bare.originalName;
      const agent = { ...fakeAgent(0, project.id, mulberry32(3), NOW), status: 'idle' as const };
      const result = buildTeamShare({ projects: [bare], agents: [agent] }, prefs, NOW, key);
      expect(result.rooms[0]?.name, name).toBe('site');
    }
  });
});
