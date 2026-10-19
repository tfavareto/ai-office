import type { BossMessage } from '@ai-office/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Backend } from '../net/backend';
import { MESSAGE_POLL_MS, MessageCenter } from './message-center';
import type { DeliverySummary } from './model/delivery';

const msg = (id: string, agentId: string, over: Partial<BossMessage> = {}): BossMessage => ({ id, agentId, text: 'oi', createdAt: 1, status: 'queued', group: 'g', ...over });

describe('MessageCenter', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('polls tracked messages and reports grouped delivery progress until complete', async () => {
    const server = new Map<string, BossMessage>([
      ['a', msg('a', '1')],
      ['b', msg('b', '2')],
    ]);
    const backend = { messages: vi.fn(async (agentId: string) => [...server.values()].filter((m) => m.agentId === agentId)) } as unknown as Backend;
    const events: { text: string; final: boolean }[] = [];
    const center = new MessageCenter({
      backend,
      nameOf: (id) => `Agente ${id}`,
      now: () => Date.now(),
      onDelivery: (summary: DeliverySummary, _agentId, final) => events.push({ text: summary.text, final }),
    });

    center.track([...server.values()], 'loja');
    server.set('a', msg('a', '1', { status: 'delivered', via: 'tool' }));
    await vi.advanceTimersByTimeAsync(MESSAGE_POLL_MS);
    expect(events).toEqual([{ text: 'Equipe loja: 1 de 2 entregue', final: false }]);

    server.set('b', msg('b', '2', { status: 'delivered', via: 'stop' }));
    await vi.advanceTimersByTimeAsync(MESSAGE_POLL_MS);
    expect(events.at(-1)).toEqual({ text: 'Equipe loja: 2 de 2 entregues', final: true });

    const calls = (backend.messages as unknown as ReturnType<typeof vi.fn>).mock.calls.length;
    await vi.advanceTimersByTimeAsync(MESSAGE_POLL_MS * 3);
    expect((backend.messages as unknown as ReturnType<typeof vi.fn>).mock.calls.length).toBe(calls);
    center.dispose();
  });

  it('keeps watched agents fresh and stops when nobody watches', async () => {
    const backend = { messages: vi.fn(async () => [msg('a', '1', { group: undefined })]) } as unknown as Backend;
    const center = new MessageCenter({ backend, nameOf: () => 'A', now: () => Date.now(), onDelivery: () => undefined });
    center.watch('view', ['1']);
    await vi.advanceTimersByTimeAsync(0);
    expect(center.messagesOf('1')).toHaveLength(1);
    center.unwatch('view');
    const calls = (backend.messages as unknown as ReturnType<typeof vi.fn>).mock.calls.length;
    await vi.advanceTimersByTimeAsync(MESSAGE_POLL_MS * 3);
    expect((backend.messages as unknown as ReturnType<typeof vi.fn>).mock.calls.length).toBe(calls);
  });
});
