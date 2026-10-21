import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { OfficeSnapshot, PendingHire } from '@ai-office/shared';
import { silentLogger } from '../log';
import { NameStore } from './name-store';
import { Office } from './office';
import { SnapshotPublisher } from './snapshot';

let clock = 10_000;
const emitted: OfficeSnapshot[] = [];

function publisher(hires: PendingHire[] = []): SnapshotPublisher {
  const office = new Office({
    now: () => clock,
    names: new NameStore(undefined, silentLogger),
    log: silentLogger,
    overlays: { permissionFor: () => undefined, attentionFor: () => undefined },
    events: { onChange: () => undefined, onFeed: () => undefined, onNotice: () => undefined, onAgentEvent: () => undefined },
  });
  office.setAccounts([{ id: 'claude', label: 'Pessoal', initial: 'P', color: '#fff', dir: '/x' }]);
  office.refresh(clock);
  return new SnapshotPublisher({
    office,
    usage: { compute: (ids) => ids.map((accountId) => ({ accountId, window5h: { tokens: 0, costUSD: 0, resetsAt: 0 }, week: { tokens: 0, costUSD: 0, resetsAt: 0 }, today: { tokens: 0, costUSD: 0 } })) },
    now: () => clock,
    meta: () => ({ version: '1.2.3', startedAt: 1, demo: false }),
    hires: () => hires,
    emit: (snapshot) => void emitted.push(snapshot),
  });
}

beforeEach(() => {
  clock = 10_000;
  emitted.length = 0;
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
});
afterEach(() => {
  vi.useRealTimers();
});

describe('SnapshotPublisher', () => {
  test('the first request publishes immediately with rev 1', () => {
    const snapshots = publisher();
    snapshots.markDirty();
    expect(emitted).toHaveLength(1);
    expect(emitted[0]).toMatchObject({ rev: 1, serverTime: 10_000, meta: { version: '1.2.3', local: true, demo: false } });
    expect(emitted[0]?.accounts).toHaveLength(1);
    expect(emitted[0]?.usage).toHaveLength(1);
  });

  test('bursts are coalesced into at most one snapshot per 250 ms', async () => {
    const snapshots = publisher();
    snapshots.markDirty();
    for (let i = 0; i < 50; i++) snapshots.markDirty();
    expect(emitted).toHaveLength(1);
    clock += 100;
    await vi.advanceTimersByTimeAsync(149);
    expect(emitted).toHaveLength(1);
    clock += 150;
    await vi.advanceTimersByTimeAsync(102);
    expect(emitted).toHaveLength(2);
    expect(emitted[1]?.rev).toBe(2);
  });

  test('over one second there are never more than 4 publications plus the first', async () => {
    const snapshots = publisher();
    for (let t = 0; t < 1000; t += 10) {
      snapshots.markDirty();
      clock += 10;
      await vi.advanceTimersByTimeAsync(10);
    }
    expect(emitted.length).toBeLessThanOrEqual(5);
    expect(emitted.length).toBeGreaterThanOrEqual(3);
  });

  test('pending hires travel in the snapshot, and the field is absent when there are none', () => {
    const hire: PendingHire = { id: 'h1', projectId: '/work/app', accountId: 'claude', createdAt: 9000, expiresAt: 99_000 };

    expect(publisher([hire]).build().hires).toEqual([hire]);
    expect(publisher().build().hires).toBeUndefined();
  });

  test('build() does not change rev', () => {
    const snapshots = publisher();
    snapshots.markDirty();
    expect(snapshots.build().rev).toBe(1);
    expect(snapshots.build().rev).toBe(1);
  });
});
