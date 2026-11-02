import type { Account, Agent, Project } from '@ai-office/shared';
import { describe, expect, test } from 'vitest';
import { roomAccount, routineTerminals, type RoomTerminals } from './room';

const NOW = 1_000_000;
const room = { id: 'room', path: '/w/p' } as Project;
const agent = (over: Partial<Agent>): Agent =>
  ({ projectId: 'room', status: 'idle', terminalId: 't1', accountId: 'a1', ...over }) as Agent;
const terminals = (over: Partial<RoomTerminals> = {}): RoomTerminals => ({
  list: () => [{ id: 't1', cwd: '/w/p' }],
  typedAt: () => undefined,
  ...over,
});

describe('routineTerminals', () => {
  test('an idle agent in a real terminal is free', () => {
    const state = { projects: [room], agents: [agent({})] };
    expect(routineTerminals(state, terminals(), '/w/p', NOW)).toEqual([{ id: 't1', busy: false }]);
  });

  test('an agent working or waiting for an answer is not', () => {
    for (const status of ['working', 'waiting', 'offline'] as const) {
      const state = { projects: [room], agents: [agent({ status })] };
      expect(routineTerminals(state, terminals(), '/w/p', NOW)[0]?.busy, status).toBe(true);
    }
  });

  test('a terminal typed in during the last minute is not, and is again after it', () => {
    // Arrange
    const state = { projects: [room], agents: [agent({})] };
    const typed = terminals({ typedAt: () => NOW - 59_000 });

    // Act and assert
    expect(routineTerminals(state, typed, '/w/p', NOW)[0]?.busy).toBe(true);
    expect(routineTerminals(state, typed, '/w/p', NOW + 2_000)[0]?.busy).toBe(false);
  });

  test('a terminal still without a session counts as busy, so no routine opens another', () => {
    const state = { projects: [room], agents: [] };
    expect(routineTerminals(state, terminals(), '/w/p', NOW)).toEqual([{ id: 't1', busy: true }]);
  });

  test('ignores agents outside a real terminal, other folders and ended programs', () => {
    // Arrange
    const state = { projects: [room], agents: [agent({ terminalId: undefined })] };
    const others = terminals({
      list: () => [
        { id: 't2', cwd: '/w/other' },
        { id: 't3', cwd: '/w/p', exitCode: 0 },
      ],
    });

    // Act and assert
    expect(routineTerminals(state, others, '/w/p', NOW)).toEqual([]);
  });
});

describe('roomAccount', () => {
  const accounts = [{ id: 'a1' }] as Account[];

  test('is the account the room works on', () => {
    expect(roomAccount({ projects: [room], agents: [agent({})] }, accounts, '/w/p')).toBe('a1');
  });

  test('skips an account it does not know, and an empty room has none', () => {
    expect(
      roomAccount({ projects: [room], agents: [agent({ accountId: 'codex' })] }, accounts, '/w/p'),
    ).toBeUndefined();
    expect(roomAccount({ projects: [room], agents: [] }, accounts, '/w/p')).toBeUndefined();
  });
});
