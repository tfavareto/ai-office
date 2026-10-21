import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { BossMessage } from '@ai-office/shared';
import { AttentionRegistry } from './attention';
import { MESSAGES_KEPT, MESSAGE_TTL_MS, MessageRegistry } from './messages';

let clock = 5_000_000;
let delivered: BossMessage[] = [];

function registry(): MessageRegistry {
  return new MessageRegistry({
    now: () => clock,
    onChange: () => undefined,
    onDelivered: (message) => void delivered.push(message),
  });
}

beforeEach(() => {
  clock = 5_000_000;
  delivered = [];
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('MessageRegistry', () => {
  test('queues a message and hands it out once, marking delivery via tool or stop', () => {
    const messages = registry();
    const [sent] = messages.send(['a1'], 'Como está indo?');
    expect(sent).toMatchObject({ agentId: 'a1', status: 'queued', text: 'Como está indo?' });
    expect(sent?.group).toBeUndefined();
    expect(messages.take('a1', 'tool')).toEqual([{ id: sent?.id, text: 'Como está indo?', createdAt: clock }]);
    expect(messages.take('a1', 'tool')).toEqual([]);
    expect(messages.list('a1')[0]).toMatchObject({ status: 'delivered', via: 'tool', deliveredAt: clock });
    expect(delivered).toHaveLength(1);
    messages.send(['a1'], 'de novo');
    messages.take('a1', 'stop');
    expect(messages.list('a1')[1]).toMatchObject({ via: 'stop' });
  });

  test('team messages share a group id, are de-duplicated and capped at 24 agents', () => {
    const messages = registry();
    const ids = Array.from({ length: 30 }, (_, i) => `a${i}`);
    const sent = messages.send([...ids, 'a0'], 'Atenção, time');
    expect(sent).toHaveLength(24);
    expect(new Set(sent.map((m) => m.group)).size).toBe(1);
    expect(sent[0]?.group).toBeDefined();
  });

  test('keeps only the last 50 messages per agent', () => {
    const messages = registry();
    for (let i = 0; i < MESSAGES_KEPT + 10; i++) messages.send(['a1'], `m${i}`);
    const list = messages.list('a1');
    expect(list).toHaveLength(MESSAGES_KEPT);
    expect(list[0]?.text).toBe('m10');
  });

  test('queued messages expire after 2 hours', () => {
    const messages = registry();
    messages.send(['a1'], 'velha');
    clock += MESSAGE_TTL_MS + 1;
    expect(messages.take('a1', 'tool')).toEqual([]);
    expect(messages.list('a1')[0]?.status).toBe('expired');
  });

  test('wait resolves immediately when something is queued', async () => {
    const messages = registry();
    messages.send(['a1'], 'já está na fila');
    const result = await messages.wait('a1', 25_000);
    expect(result.map((m) => m.text)).toEqual(['já está na fila']);
  });

  test('wait wakes up when a message arrives and delivers it as a new instruction', async () => {
    const messages = registry();
    const waiting = messages.wait('a1', 25_000);
    messages.send(['a1'], 'acorde');
    expect((await waiting).map((m) => m.text)).toEqual(['acorde']);
    expect(messages.list('a1')[0]?.via).toBe('stop');
  });

  test('wait returns an empty list on timeout (capped at 25 s) and on abort', async () => {
    const messages = registry();
    const waiting = messages.wait('a1', 999_000);
    await vi.advanceTimersByTimeAsync(25_001);
    await expect(waiting).resolves.toEqual([]);
    const controller = new AbortController();
    const aborted = messages.wait('a1', 25_000, controller.signal);
    controller.abort();
    await expect(aborted).resolves.toEqual([]);
  });
});

describe('AttentionRegistry', () => {
  test('marks needs-you, ignores idle prompts, clears on the next transcript event', () => {
    let now = 1000;
    let changes = 0;
    const attention = new AttentionRegistry(
      () => now,
      () => void changes++,
    );
    expect(attention.mark('a1', { message: 'Claude is waiting for your input' })).toBe(false);
    expect(attention.mark('a1', { notificationType: 'idle_prompt' })).toBe(false);
    expect(attention.messageFor('a1')).toBeUndefined();
    expect(attention.mark('a1', { message: 'Claude needs your permission to use Bash' })).toBe(true);
    expect(attention.messageFor('a1')).toBe('Precisa de você');
    attention.clearIfEventAfter('a1', 900);
    expect(attention.messageFor('a1')).toBe('Precisa de você');
    attention.clearIfEventAfter('a1', 1500);
    expect(attention.messageFor('a1')).toBeUndefined();
    expect(changes).toBe(2);
    attention.mark('a2', {});
    now += 31 * 60_000;
    expect(attention.messageFor('a2')).toBeUndefined();
  });
});
