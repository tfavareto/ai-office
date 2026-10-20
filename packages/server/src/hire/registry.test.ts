import { describe, expect, test } from 'vitest';
import { type Agent, HIRE_HANDOVER_MS, HIRE_WINDOW_MS, type PendingHire } from '@ai-office/shared';
import { HireRegistry, START_SLACK_MS } from './registry';

const T0 = 1_800_000_000_000;

function agent(id: string, overrides: Partial<Agent> = {}): Agent {
  return {
    id,
    kind: 'main',
    sessionId: id,
    accountId: 'claude',
    projectId: '/work/app',
    name: 'Ana',
    role: 'Principal',
    look: 'f',
    seed: 1,
    status: 'idle',
    statusSince: T0,
    recent: [],
    tasks: [],
    shells: [],
    stats: { toolCalls: 0, tokensIn: 0, tokensOut: 0, linesAdded: 0, linesRemoved: 0, subagents: 0 },
    startedAt: T0 + 3000,
    lastEventAt: T0 + 3000,
    ...overrides,
  };
}

function setup() {
  let clock = T0;
  let counter = 0;
  const changes: number[] = [];
  const expired: PendingHire[] = [];
  const registry = new HireRegistry({
    now: () => clock,
    newId: () => `hire-${++counter}`,
    onChange: () => void changes.push(clock),
    onExpired: (hire) => void expired.push(hire),
  });
  return {
    registry,
    changes,
    expired,
    advance: (ms: number) => void (clock += ms),
    now: () => clock,
  };
}

const NEW_HIRE = { projectId: '/work/app', accountId: 'claude', matchPaths: ['/work/app', '/private/work/app'] } as const;

describe('HireRegistry', () => {
  test('creating a hire announces the change and lists the placeholder', () => {
    const { registry, changes, now } = setup();

    const hire = registry.create({ ...NEW_HIRE, deskIndex: 2 });

    expect(hire).toMatchObject({ id: 'hire-1', projectId: '/work/app', accountId: 'claude', deskIndex: 2, createdAt: T0, expiresAt: T0 + HIRE_WINDOW_MS });
    expect(registry.list(now())).toEqual([hire]);
    expect(changes).toHaveLength(1);
  });

  test('hands the placeholder over to the session that started in the folder under the same account', () => {
    const { registry, advance, now } = setup();
    const hire = registry.create(NEW_HIRE);
    advance(4000);

    registry.sweep([agent('claude:s1')], now());

    expect(registry.list(now())).toEqual([{ ...hire, agentId: 'claude:s1' }]);
  });

  test('matches a session that reports the resolved path of the folder', () => {
    const { registry, now } = setup();
    registry.create(NEW_HIRE);

    registry.sweep([agent('claude:s1', { projectId: '/private/work/app' })], now());

    expect(registry.list(now())[0]?.agentId).toBe('claude:s1');
  });

  test.each([
    ['another account', { accountId: 'work' }],
    ['another folder', { projectId: '/work/other' }],
    ['a session that was already open before the hire', { startedAt: T0 - START_SLACK_MS - 1 }],
    ['a subagent', { kind: 'sub' as const }],
    ['a demo agent', { demo: true }],
    ['a session that already ended', { status: 'offline' as const }],
  ])('does not match %s', (_name, overrides) => {
    const { registry, now } = setup();
    registry.create(NEW_HIRE);

    registry.sweep([agent('claude:s1', overrides)], now());

    expect(registry.list(now())[0]?.agentId).toBeUndefined();
  });

  test('two hires for the same folder take the two sessions in order of start', () => {
    const { registry, advance, now } = setup();
    registry.create(NEW_HIRE);
    advance(500);
    registry.create(NEW_HIRE);
    advance(5000);

    registry.sweep([agent('claude:late', { startedAt: T0 + 5000 }), agent('claude:early', { startedAt: T0 + 3000 })], now());

    expect(registry.list(now()).map((hire) => hire.agentId)).toEqual(['claude:early', 'claude:late']);
  });

  test('one session never takes over two hires', () => {
    const { registry, now } = setup();
    registry.create(NEW_HIRE);
    registry.create(NEW_HIRE);

    registry.sweep([agent('claude:s1')], now());

    expect(registry.list(now()).map((hire) => hire.agentId)).toEqual(['claude:s1', undefined]);
  });

  test('forgets a handed-over hire after the handover period', () => {
    const { registry, advance, now } = setup();
    registry.create(NEW_HIRE);
    registry.sweep([agent('claude:s1')], now());
    advance(HIRE_HANDOVER_MS);

    registry.sweep([agent('claude:s1')], now());

    expect(registry.list(now())).toEqual([]);
  });

  test('reports a hire that found no session within the window, once', () => {
    const { registry, expired, changes, advance, now } = setup();
    const hire = registry.create(NEW_HIRE);
    advance(HIRE_WINDOW_MS);

    registry.sweep([], now());
    registry.sweep([], now());

    expect(expired).toEqual([hire]);
    expect(registry.list(now())).toEqual([]);
    expect(changes).toHaveLength(2);
  });

  test('sweeping with nothing to do does not announce a change', () => {
    const { registry, changes, now } = setup();
    registry.create(NEW_HIRE);

    registry.sweep([], now());

    expect(changes).toHaveLength(1);
  });
});
