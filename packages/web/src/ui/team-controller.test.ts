import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { DEFAULT_TEAM_SHARE, type TeamStatus } from '@ai-office/shared';
import { type Backend, TeamRejectedError } from '../net/backend';
import { TEAM_POLL_MS, TeamController } from './team-controller';

const status = (role: TeamStatus['role'] = null): TeamStatus => ({
  available: true,
  role,
  sharing: { ...DEFAULT_TEAM_SHARE },
  interfaces: [],
});

function fake(overrides: Partial<Backend> = {}): Backend {
  return { teamStatus: vi.fn(async () => status()), ...overrides } as unknown as Backend;
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('TeamController', () => {
  test('loads the status when started and refreshes it while open', async () => {
    const backend = fake();
    const controller = new TeamController(() => backend);

    controller.start();
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(TEAM_POLL_MS * 2);

    expect(controller.get().status).toMatchObject({ available: true });
    expect(backend.teamStatus).toHaveBeenCalledTimes(3);
    controller.stop();
    await vi.advanceTimersByTimeAsync(TEAM_POLL_MS * 3);
    expect(backend.teamStatus).toHaveBeenCalledTimes(3);
  });

  test('an action replaces the status; a refused one explains why in words', async () => {
    const backend = fake({
      teamJoin: vi.fn(async () => {
        throw new TeamRejectedError('pairing-failed', 403);
      }),
      teamLeave: vi.fn(async () => status()),
    });
    const controller = new TeamController(() => backend);

    const refused = await controller.join({ address: '1.2.3.4', code: 'X', name: 'A' });
    const left = await controller.leave();

    expect(refused).toEqual({ ok: false, message: expect.stringContaining('Código errado') });
    expect(controller.get().busy).toBe(false);
    expect(left).toEqual({ ok: true });
    expect(controller.get().error).toBe('');
  });

  test('a refresh does not wipe the explanation of a refused action', async () => {
    const backend = fake({
      teamJoin: vi.fn(async () => {
        throw new TeamRejectedError('pairing-failed', 403);
      }),
    });
    const controller = new TeamController(() => backend);
    await controller.join({ address: '1.2.3.4', code: 'X', name: 'A' });

    await controller.load(true);

    expect(controller.get().error).toContain('Código errado');
    await controller.load(false);
    expect(controller.get().error).toBe('');
  });

  test('a failed refresh keeps what is shown', async () => {
    let fail = false;
    const backend = fake({
      teamStatus: vi.fn(async () => {
        if (fail) throw new Error('boom');
        return status('host');
      }),
    });
    const controller = new TeamController(() => backend);
    await controller.load(false);

    fail = true;
    await controller.load(true);

    expect(controller.get().status?.role).toBe('host');
    expect(controller.get().error).toBe('');
  });
});
