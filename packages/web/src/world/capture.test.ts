import type { OfficeSnapshot } from '@ai-office/shared';
import { describe, expect, it } from 'vitest';
import { account, activity, agent, project, snapshot } from '../test/fixtures';
import { MAX_CAPTURE_SIDE, MIN_CAPTURE_SIDE, captureSize, captureSnapshot } from './capture';

const roomLabel = (n: number): string => `Room ${n}`;

function sensitiveOffice(): OfficeSnapshot {
  return snapshot({
    accounts: [account({ id: 'acc1', label: 'Secret account', dir: '/Users/me/.claude-secret' })],
    projects: [
      project({
        id: '/Users/me/clients/acme-bank',
        name: 'acme-bank',
        path: '/Users/me/clients/acme-bank',
        order: 1,
        git: undefined,
      }),
      project({ id: '/Users/me/side/novel', name: 'novel', path: '/Users/me/side/novel', order: 0, seed: 9 }),
    ],
    agents: [
      agent({
        id: 'a1',
        projectId: '/Users/me/clients/acme-bank',
        title: 'Fix the wire transfer bug',
        activity: activity({ text: 'Editing payments.ts', detail: 'src/payments.ts' }),
        recent: [activity({ text: 'Reading secrets.env' })],
        tasks: [
          { id: 't1', title: 'Rotate the production key', activeForm: 'Rotating the key', status: 'in_progress' },
        ],
        shells: [{ id: 's1', label: 'curl https://internal.example', background: false, kind: 'shell', startedAt: 1 }],
        waitingFor: 'Approve rm -rf',
        gitBranch: 'feature/secret-launch',
      }),
      agent({ id: 'a2', projectId: '/Users/me/side/novel', name: 'Bruno' }),
      agent({ id: 'a3', projectId: '/Users/me/elsewhere', name: 'Orphan' }),
    ],
  });
}

describe('captureSnapshot', () => {
  it('hides project names, paths and everything the user wrote by default', () => {
    // Arrange
    const source = sensitiveOffice();

    // Act
    const safe = captureSnapshot(source, { showProjectNames: false, roomLabel });
    const text = JSON.stringify(safe);

    // Assert
    for (const secret of [
      'acme-bank',
      'novel',
      '/Users/me',
      'wire transfer',
      'payments.ts',
      'secrets.env',
      'production key',
      'Rotating',
      'internal.example',
      'rm -rf',
      'secret-launch',
      'Secret account',
    ])
      expect(text, secret).not.toContain(secret);
    expect(safe.projects.map((p) => p.name)).toEqual(['Room 1', 'Room 2']);
  });

  it('keeps the office level, so the picture shows its decoration, but not who is the employee of the month', () => {
    const source = {
      ...sensitiveOffice(),
      progress: {
        level: 6,
        xp: 5200,
        from: 5000,
        to: 9000,
        achievements: 9,
        total: 22,
        recent: [{ id: 'tasks100' as const, at: 5 }],
        employee: 'Zeferina',
      },
    };

    const safe = captureSnapshot(source, { showProjectNames: false, roomLabel });

    expect(safe.progress).toMatchObject({ level: 6, achievements: 9, recent: [] });
    expect(JSON.stringify(safe)).not.toContain('Zeferina');
  });

  it('numbers the rooms in order of arrival and keeps each agent in its room', () => {
    const safe = captureSnapshot(sensitiveOffice(), { showProjectNames: false, roomLabel });

    expect(safe.projects.map((p) => p.id)).toEqual(['room-1', 'room-2']);
    expect(safe.agents.find((a) => a.id === 'a2')?.projectId).toBe('room-1');
    expect(safe.agents.find((a) => a.id === 'a1')?.projectId).toBe('room-2');
  });

  it('keeps the project names only when asked to', () => {
    const safe = captureSnapshot(sensitiveOffice(), { showProjectNames: true, roomLabel });

    expect(safe.projects.map((p) => p.name)).toEqual(['novel', 'acme-bank']);
    expect(JSON.stringify(safe)).not.toContain('/Users/me');
  });

  it('keeps what the picture needs: status, kind of activity, seeds and colors', () => {
    const safe = captureSnapshot(sensitiveOffice(), { showProjectNames: false, roomLabel });
    const first = safe.agents.find((a) => a.id === 'a1');

    expect(first?.status).toBe('working');
    expect(first?.activity?.kind).toBe('read');
    expect(first?.seed).toBe(42);
    expect(first?.tasks[0]?.status).toBe('in_progress');
    expect(safe.accounts[0]?.color).toBe('#2f6fed');
    expect(safe.projects[0]?.seed).toBe(9);
  });

  it('drops agents of unknown projects, pending hires and usage', () => {
    const safe = captureSnapshot({ ...sensitiveOffice(), hires: [] }, { showProjectNames: false, roomLabel });

    expect(safe.agents.map((a) => a.id).sort()).toEqual(['a1', 'a2']);
    expect(safe.hires).toBeUndefined();
    expect(safe.usage).toEqual([]);
    expect(safe.meta.local).toBe(false);
  });

  it('does not change the snapshot it was given', () => {
    const source = sensitiveOffice();
    const before = JSON.stringify(source);

    captureSnapshot(source, { showProjectNames: false, roomLabel });

    expect(JSON.stringify(source)).toBe(before);
  });
});

describe('captureSnapshot with a customized office', () => {
  it('keeps the looks and finishes (they say nothing private) and follows the arrangement of the building', () => {
    const source = snapshot({
      projects: [
        project({ id: '/a', name: 'a', order: 0, theme: { floor: 'wood', sign: 'neon' } }),
        project({ id: '/b', name: 'Casa', originalName: 'secret-b', order: 1, pinned: true, rank: 0 }),
        project({ id: '/c', name: 'c', order: 2, hidden: true }),
      ],
      agents: [
        agent({ id: 'x', projectId: '/a', appearance: { accessory: 'cap', outfit: 'teal' } }),
        agent({ id: 'y', projectId: '/b' }),
        agent({ id: 'z', projectId: '/c' }),
      ],
    });
    const safe = captureSnapshot(source, { showProjectNames: false, roomLabel });
    expect(safe.projects.map((p) => p.name)).toEqual(['Room 1', 'Room 2']);
    expect(safe.projects[1]?.theme).toEqual({ floor: 'wood', sign: 'neon' });
    expect(safe.agents.map((a) => a.id)).toEqual(['x', 'y']);
    expect(safe.agents[0]?.appearance).toEqual({ accessory: 'cap', outfit: 'teal' });
    expect(JSON.stringify(safe)).not.toContain('secret-b');
    expect(JSON.stringify(safe)).not.toContain('Casa');
  });
});

describe('captureSize', () => {
  it('rounds to whole pixels', () => {
    expect(captureSize({ width: 1200.4, height: 629.6 })).toEqual({ width: 1200, height: 630 });
  });

  it('keeps the size inside the supported range', () => {
    expect(captureSize({ width: 0, height: 99_999 })).toEqual({ width: MIN_CAPTURE_SIDE, height: MAX_CAPTURE_SIDE });
    expect(captureSize({ width: Number.NaN, height: -5 })).toEqual({
      width: MIN_CAPTURE_SIDE,
      height: MIN_CAPTURE_SIDE,
    });
  });
});
