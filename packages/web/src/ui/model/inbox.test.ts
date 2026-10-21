import type { Agent } from '@ai-office/shared';
import { describe, expect, it } from 'vitest';
import { activity, agent, permission, snapshot } from '../../test/fixtures';
import {
  EXPIRING_SOON_MS,
  buildInbox,
  compareItems,
  finishedIdsOf,
  isExpired,
  isExpiringSoon,
  seenableIds,
  type InboxInput,
  type InboxItem,
} from './inbox';
import { EMPTY_INBOX_STATE, markSeen, type InboxState } from './inbox-state';
import type { NotificationItem } from './notifications';

const NOW = 100_000;
const SEEN_BASELINE: InboxState = { ...EMPTY_INBOX_STATE, baseline: 1_000 };

function input(agents: Agent[], over: Partial<InboxInput> = {}): InboxInput {
  return { snapshot: snapshot({ agents }), notifications: [], state: SEEN_BASELINE, now: NOW, ...over };
}

const waitingForPermission = (id: string, createdAt: number, expiresAt: number, over = {}) =>
  agent({
    id,
    status: 'waiting',
    statusSince: createdAt,
    permission: permission({ id: `perm-${id}`, agentId: id, createdAt, expiresAt, ...over }),
  });

const idleAfterWork = (id: string, statusSince: number) =>
  agent({ id, status: 'idle', statusSince, stats: { ...agent().stats, toolCalls: 12 } });

function ids(items: readonly InboxItem[]): string[] {
  return items.map((item) => item.id);
}

describe('buildInbox', () => {
  it('is empty without a snapshot or when nobody needs the user', () => {
    expect(buildInbox({ snapshot: null, notifications: [], state: SEEN_BASELINE, now: NOW }).items).toEqual([]);
    expect(buildInbox(input([agent({ status: 'working' }), agent({ id: 'b', status: 'idle' })])).counts.urgent).toBe(0);
  });

  it('orders by priority: permissions, then questions, then errors, then finished work', () => {
    const view = buildInbox(
      input([
        idleAfterWork('fin', 50_000),
        agent({
          id: 'err',
          status: 'idle',
          statusSince: 20_000,
          activity: activity({ id: 'x1', at: 20_000, error: true }),
        }),
        agent({ id: 'ask', status: 'waiting', statusSince: 30_000, waitingFor: 'Responder uma pergunta' }),
        waitingForPermission('perm', 90_000, 150_000),
      ]),
    );
    expect(view.items.map((item) => item.kind)).toEqual(['permission', 'attention', 'error', 'finished']);
  });

  it('orders permissions by expiry and puts expired ones last', () => {
    const view = buildInbox(
      input([
        waitingForPermission('late', 10_000, 170_000),
        waitingForPermission('gone', 5_000, 90_000),
        waitingForPermission('soon', 50_000, 120_000),
      ]),
    );
    expect(view.items.map((item) => item.agentId)).toEqual(['soon', 'late', 'gone']);
    expect(view.items[2]?.expired).toBe(true);
    expect(view.counts.permission).toBe(2);
  });

  it('orders questions and errors by how long they have waited, finished work newest first', () => {
    const view = buildInbox(
      input([
        agent({ id: 'q2', status: 'waiting', statusSince: 40_000 }),
        agent({ id: 'q1', status: 'waiting', statusSince: 20_000 }),
        idleAfterWork('f-old', 10_000),
        idleAfterWork('f-new', 60_000),
      ]),
    );
    expect(view.items.map((item) => item.agentId)).toEqual(['q1', 'q2', 'f-new', 'f-old']);
  });

  it('breaks ties by id so the order is stable', () => {
    const view = buildInbox(
      input([
        agent({ id: 'b', status: 'waiting', statusSince: 5 }),
        agent({ id: 'a', status: 'waiting', statusSince: 5 }),
      ]),
    );
    expect(view.items.map((item) => item.agentId)).toEqual(['a', 'b']);
  });

  it('ignores agents that already left, and answers from subagents count as permissions too', () => {
    const view = buildInbox(
      input([
        agent({ id: 'gone', status: 'offline', statusSince: 1 }),
        agent({
          id: 'sub',
          kind: 'sub',
          parentId: 'ag1',
          status: 'waiting',
          statusSince: 2,
          permission: permission({ id: 'p-sub', agentId: 'sub', expiresAt: 200_000 }),
        }),
        agent({
          id: 'sub-idle',
          kind: 'sub',
          status: 'idle',
          statusSince: 70_000,
          stats: { ...agent().stats, toolCalls: 3 },
        }),
      ]),
    );
    expect(ids(view.items)).toEqual(['permission:p-sub']);
  });

  it('describes a question with what the agent says it waits for', () => {
    const view = buildInbox(
      input([
        agent({
          id: 'q',
          status: 'waiting',
          statusSince: 20_000,
          waitingFor: 'Aprovar o plano',
          waitingForMsg: { key: 'waiting.approvePlan' },
        }),
      ]),
    );
    expect(view.items[0]).toMatchObject({
      kind: 'attention',
      waitingText: 'Aprovar o plano',
      waitingMsg: { key: 'waiting.approvePlan' },
    });
  });

  it('falls back to the alert notification of that agent when the agent says nothing', () => {
    const notice = (over: Partial<NotificationItem>): NotificationItem => ({
      id: 'n',
      key: 'k',
      at: 21_000,
      level: 'alert',
      kind: 'alert',
      text: 'Claude precisa da sua atenção',
      count: 1,
      read: false,
      agentId: 'q',
      ...over,
    });
    const waiting = agent({ id: 'q', status: 'waiting', statusSince: 20_000 });
    const withNotice = buildInbox(input([waiting], { notifications: [notice({})] }));
    expect(withNotice.items[0]?.waitingText).toBe('Claude precisa da sua atenção');
    const stale = buildInbox(
      input([waiting], {
        notifications: [notice({ at: 5_000 }), notice({ agentId: 'other' }), notice({ kind: 'info', level: 'info' })],
      }),
    );
    expect(stale.items[0]?.waitingText).toBeUndefined();
  });

  it('reports a failed last action of an idle agent', () => {
    const failure = activity({ id: 'boom', at: 40_000, error: true, text: 'npm run build falhou' });
    const view = buildInbox(input([agent({ id: 'e', status: 'idle', statusSince: 40_000, activity: failure })]));
    expect(view.items[0]).toMatchObject({ id: 'error:e:boom', kind: 'error', at: 40_000, failure });
  });

  describe('finished work', () => {
    it('lists main agents that went idle after the baseline and did some work', () => {
      expect(ids(buildInbox(input([idleAfterWork('a', 50_000)])).items)).toEqual(['finished:a:50000']);
    });

    it('skips agents that went idle before the baseline, never worked, or have no baseline yet', () => {
      expect(buildInbox(input([idleAfterWork('a', 500)])).items).toEqual([]);
      expect(buildInbox(input([agent({ id: 'a', status: 'idle', statusSince: 50_000 })])).items).toEqual([]);
      expect(buildInbox(input([idleAfterWork('a', 50_000)], { state: EMPTY_INBOX_STATE })).items).toEqual([]);
    });

    it('skips agents that still run a shell and agents idle for more than a day', () => {
      const shell = { id: 's', label: 'dev', background: true, kind: 'shell' as const, startedAt: 1 };
      expect(buildInbox(input([{ ...idleAfterWork('a', 50_000), shells: [shell] }])).items).toEqual([]);
      expect(buildInbox(input([idleAfterWork('a', 50_000)], { now: 50_000 + 25 * 3_600_000 })).items).toEqual([]);
    });
  });

  describe('seen', () => {
    it('hides a seen item and counts only what is unseen', () => {
      const agents = [idleAfterWork('a', 50_000), agent({ id: 'q', status: 'waiting', statusSince: 20_000 })];
      const state = markSeen(SEEN_BASELINE, ['finished:a:50000'], NOW);
      const view = buildInbox(input(agents, { state }));
      expect(ids(view.items)).toEqual(['attention:q:20000']);
      expect(view.counts).toMatchObject({ finished: 0, attention: 1, urgent: 1 });
    });

    it('brings an item back as unseen when it happens again', () => {
      const state = markSeen(SEEN_BASELINE, ['attention:q:20000', 'finished:a:50000'], NOW);
      const again = [agent({ id: 'q', status: 'waiting', statusSince: 80_000 }), idleAfterWork('a', 90_000)];
      expect(ids(buildInbox(input(again, { state })).items)).toEqual(['attention:q:80000', 'finished:a:90000']);
    });

    it('never hides a permission request, seen or not', () => {
      const request = waitingForPermission('p', 10_000, 150_000);
      const state = markSeen(SEEN_BASELINE, ['permission:perm-p'], NOW);
      expect(buildInbox(input([request], { state })).items).toHaveLength(1);
    });
  });

  it('counts urgent as open permissions plus unseen questions and errors, not finished work or expired requests', () => {
    const view = buildInbox(
      input([
        waitingForPermission('p', 10_000, 150_000),
        waitingForPermission('x', 10_000, 90_000),
        agent({ id: 'q', status: 'waiting', statusSince: 20_000 }),
        agent({ id: 'e', status: 'idle', statusSince: 30_000, activity: activity({ id: 'e1', error: true }) }),
        idleAfterWork('f', 50_000),
      ]),
    );
    expect(view.counts).toEqual({ permission: 1, attention: 1, error: 1, finished: 1, urgent: 3 });
  });

  it('marks risky and similar permission requests', () => {
    const view = buildInbox(
      input([
        waitingForPermission('a', 10_000, 150_000, { input: { command: 'rm -rf dist' }, summary: 'rm -rf dist' }),
        waitingForPermission('b', 11_000, 150_000),
        waitingForPermission('c', 12_000, 150_000),
      ]),
    );
    const [risky, b, c] = view.items;
    expect(risky?.risk).toBe('delete');
    expect(b?.risk).toBeUndefined();
    expect(b?.similarKey).toBe(c?.similarKey);
  });
});

describe('expiry', () => {
  it('knows when a request expired or is about to', () => {
    expect(isExpired({ expiresAt: NOW }, NOW)).toBe(true);
    expect(isExpired({ expiresAt: NOW + 1 }, NOW)).toBe(false);
    expect(isExpiringSoon({ expiresAt: NOW + EXPIRING_SOON_MS }, NOW)).toBe(true);
    expect(isExpiringSoon({ expiresAt: NOW + EXPIRING_SOON_MS + 1 }, NOW)).toBe(false);
    expect(isExpiringSoon({ expiresAt: NOW - 1 }, NOW)).toBe(false);
  });
});

describe('helpers', () => {
  const items = buildInbox(
    input([
      waitingForPermission('p', 10_000, 150_000),
      agent({ id: 'q', status: 'waiting', statusSince: 20_000 }),
      idleAfterWork('f', 50_000),
    ]),
  ).items;

  it('lists the items that can be marked as seen: everything but permissions', () => {
    expect(seenableIds(items)).toEqual(['attention:q:20000', 'finished:f:50000']);
  });

  it('finds the finished items of one agent', () => {
    expect(finishedIdsOf(items, 'f')).toEqual(['finished:f:50000']);
    expect(finishedIdsOf(items, 'q')).toEqual([]);
  });

  it('compares equal items as equal', () => {
    expect(compareItems(items[0] as InboxItem, items[0] as InboxItem)).toBe(0);
  });
});
