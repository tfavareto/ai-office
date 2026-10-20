import type { Agent, OfficeSnapshot } from '@ai-office/shared';
import { describe, expect, it } from 'vitest';
import { agent, permission, snapshot } from '../test/fixtures';
import { InboxController } from './inbox-controller';
import { planBulk } from './model/inbox-bulk';
import { INBOX_STORAGE_KEY } from './model/inbox-state';

class MemoryStorage {
  readonly data = new Map<string, string>();
  getItem(key: string): string | null {
    return this.data.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.data.set(key, value);
  }
}

const request = (id: string) =>
  agent({ id, status: 'waiting', statusSince: 2_000, permission: permission({ id: `perm-${id}`, agentId: id, createdAt: 2_000 + id.charCodeAt(0), expiresAt: 600_000 }) });
const finished = (id: string, statusSince: number) => agent({ id, status: 'idle', statusSince, stats: { ...agent().stats, toolCalls: 4 } });

function setup(agents: Agent[], storage: MemoryStorage | null = new MemoryStorage()) {
  let current: OfficeSnapshot = snapshot({ agents, serverTime: 1_000 });
  const controller = new InboxController({ snapshot: () => current, notifications: () => [], now: () => current.serverTime + 5_000, storage });
  const publish = (next: Agent[], serverTime = current.serverTime): void => {
    current = snapshot({ agents: next, serverTime });
    controller.sync(current);
  };
  controller.sync(current);
  return { controller, publish, storage };
}

describe('InboxController', () => {
  it('lists permission requests from the snapshot', () => {
    const { controller } = setup([request('a'), request('b')]);
    expect(controller.view().items.map((item) => item.agentId)).toEqual(['a', 'b']);
  });

  it('starts the cursor on the first row and keeps it on the same item when others arrive', () => {
    const { controller, publish } = setup([request('b')]);
    expect(controller.get().cursor).toBe('permission:perm-b');
    publish([request('a'), request('b')]);
    expect(controller.get().cursor).toBe('permission:perm-b');
  });

  it('moves the cursor to the next row when the item under it is decided', () => {
    const { controller, publish } = setup([request('a'), request('b'), request('c')]);
    controller.setCursor('permission:perm-b');
    publish([request('a'), request('c')]);
    expect(controller.get().cursor).toBe('permission:perm-c');
  });

  it('forgets selected, denying and confirming items that disappeared', () => {
    const { controller, publish } = setup([request('a'), request('b')]);
    controller.toggleSelected('permission:perm-a');
    controller.toggleSelected('permission:perm-b');
    controller.set({ denying: 'permission:perm-a', confirm: planBulk('deny', controller.view().items) });
    publish([request('b')]);
    expect(controller.get().selection.ids).toEqual(['permission:perm-b']);
    expect(controller.get().denying).toBeNull();
    expect(controller.get().confirm).toBeNull();
  });

  it('selects a range with shift-click from the last toggled item', () => {
    const { controller } = setup([request('a'), request('b'), request('c')]);
    controller.toggleSelected('permission:perm-a');
    controller.selectRangeTo('permission:perm-c');
    expect(controller.get().selection.ids).toEqual(['permission:perm-a', 'permission:perm-b', 'permission:perm-c']);
    controller.clearSelection();
    expect(controller.get().selection.ids).toEqual([]);
  });

  it('moves the cursor with the keyboard', () => {
    const { controller } = setup([request('a'), request('b')]);
    expect(controller.moveCursor(1)).toBe('permission:perm-b');
    expect(controller.moveCursor(1)).toBe('permission:perm-b');
    expect(controller.moveCursor(-1)).toBe('permission:perm-a');
  });

  describe('finished work and seen marks', () => {
    it('only lists work that finished after the first snapshot', () => {
      const { controller, publish } = setup([finished('old', 500)]);
      expect(controller.view().items).toEqual([]);
      publish([finished('old', 500), finished('new', 3_000)], 4_000);
      expect(controller.view().items.map((item) => item.id)).toEqual(['finished:new:3000']);
    });

    it('hides what was marked as seen and remembers it in the browser store', () => {
      const { controller, publish, storage } = setup([]);
      publish([finished('a', 3_000)], 4_000);
      controller.markSeen(['finished:a:3000']);
      expect(controller.view().items).toEqual([]);
      expect(storage?.data.get(INBOX_STORAGE_KEY)).toContain('finished:a:3000');
    });

    it('restores the seen marks and the baseline on the next page load', () => {
      const first = setup([]);
      first.publish([finished('a', 3_000)], 4_000);
      first.controller.markSeen(['finished:a:3000']);
      const reloaded = setup([finished('a', 3_000), finished('b', 3_500)], first.storage);
      expect(reloaded.controller.view().items.map((item) => item.id)).toEqual(['finished:b:3500']);
    });

    it('counts opening an agent as seeing its finished work', () => {
      const { controller, publish } = setup([]);
      publish([finished('a', 3_000), finished('b', 3_100)], 4_000);
      controller.markAgentSeen('a');
      expect(controller.view().items.map((item) => item.agentId)).toEqual(['b']);
    });
  });

  it('works without any storage', () => {
    const { controller, publish } = setup([], null);
    publish([finished('a', 3_000)], 4_000);
    controller.markSeen(['finished:a:3000']);
    expect(controller.view().items).toEqual([]);
  });

  it('tracks items that are being answered', () => {
    const { controller } = setup([request('a')]);
    controller.setBusy(['permission:perm-a'], true);
    expect(controller.get().busy).toEqual(['permission:perm-a']);
    controller.setBusy(['permission:perm-a'], false);
    expect(controller.get().busy).toEqual([]);
  });

  it('survives corrupt stored data', () => {
    const storage = new MemoryStorage();
    storage.setItem(INBOX_STORAGE_KEY, '{oops');
    const { controller } = setup([request('a')], storage);
    expect(controller.view().items).toHaveLength(1);
  });
});
