import type { BossMessage, Notice, TranscriptEntry } from '@ai-office/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setLocale } from '../../i18n';
import { agent } from '../../test/fixtures';
import { aggregateDay } from './day';
import { summarizeDelivery } from './delivery';
import { groupMessages, groupStatusLabel, mergeMessages, messageStatusLabel, validateMessageText } from './messages';
import {
  EMPTY_NOTIFICATIONS,
  addNotice,
  classifyNotice,
  clearAll,
  filterItems,
  markAllRead,
  setDnd,
  shouldInterrupt,
  unreadCount,
  upsertGrouped,
} from './notifications';
import { entrySearchText, findMatches, mergeTranscript, splitFences, splitHighlight, stepMatch, toolPreview } from './terminal';
import { expireToasts, pushToast, resolveAlertToasts } from './toasts';

// Texts are asserted in pt-BR (the source language); the blocks at the end of the file check English and Spanish.
beforeEach(() => setLocale('pt-BR'));
afterEach(() => setLocale('pt-BR'));

const notice = (over: Partial<Notice> = {}): Notice => ({ id: 'n1', at: 1_000, level: 'info', text: 'Pronto', ...over });
const message = (over: Partial<BossMessage> = {}): BossMessage => ({ id: 'm1', agentId: 'ag1', text: 'oi', createdAt: 1, status: 'queued', ...over });

describe('messages', () => {
  it('labels delivery statuses', () => {
    expect(messageStatusLabel(message())).toBe('Na fila');
    expect(messageStatusLabel(message({ status: 'delivered', via: 'tool' }))).toBe('Entregue durante o trabalho');
    expect(messageStatusLabel(message({ status: 'delivered', via: 'stop' }))).toBe('Entregue como nova instrução');
    expect(messageStatusLabel(message({ status: 'expired' }))).toBe('Expirou');
  });

  it('groups team messages and summarizes deliveries', () => {
    const groups = groupMessages([
      message({ id: 'a', agentId: '1', group: 'g', status: 'delivered', via: 'tool', createdAt: 5 }),
      message({ id: 'b', agentId: '2', group: 'g', status: 'queued', createdAt: 5 }),
      message({ id: 'c', agentId: '3', group: 'g', status: 'delivered', via: 'stop', createdAt: 5 }),
      message({ id: 'd', agentId: '1', createdAt: 9 }),
    ]);
    expect(groups.map((g) => g.key)).toEqual(['d', 'g']);
    expect(groupStatusLabel(groups[1])).toBe('2 de 3 entregues · 1 na fila');
    expect(groupStatusLabel(groups[0])).toBe('Na fila');
  });

  it('merges fresh statuses by id', () => {
    const merged = mergeMessages([message({ id: 'a', createdAt: 1 })], [message({ id: 'a', createdAt: 1, status: 'delivered' }), message({ id: 'b', createdAt: 2 })]);
    expect(merged.map((m) => `${m.id}:${m.status}`)).toEqual(['a:delivered', 'b:queued']);
  });

  it('validates the text', () => {
    expect(validateMessageText('   ').ok).toBe(false);
    expect(validateMessageText('x'.repeat(5000)).ok).toBe(false);
    expect(validateMessageText('  oi  ')).toEqual({ ok: true, text: 'oi' });
  });

  it('summarizes single and team deliveries for notifications', () => {
    const ctx = { nameOf: (id: string) => (id === '1' ? 'Ana' : 'Bruno'), teamLabel: 'loja' };
    expect(summarizeDelivery([message({ agentId: '1', status: 'delivered', via: 'tool' })], ctx)?.text).toBe('Ana recebeu sua mensagem durante o trabalho.');
    const team = [message({ id: 'a', agentId: '1', group: 'g', status: 'delivered' }), message({ id: 'b', agentId: '2', group: 'g' })];
    const summary = summarizeDelivery(team, ctx);
    expect(summary?.text).toBe('Equipe loja: 1 de 2 entregue');
    expect(summary?.complete).toBe(false);
    expect(summarizeDelivery([], ctx)).toBeNull();
  });
});

describe('notifications', () => {
  it('classifies notices', () => {
    expect(classifyNotice(notice({ level: 'alert' }))).toBe('alert');
    expect(classifyNotice(notice({ text: 'Mensagem entregue a Ana' }))).toBe('message');
    expect(classifyNotice(notice())).toBe('info');
  });

  it('dedupes repeats inside the window and counts them', () => {
    let state = EMPTY_NOTIFICATIONS;
    const first = addNotice(state, notice({ at: 1_000 }));
    state = first.state;
    const second = addNotice(state, notice({ id: 'n2', at: 5_000 }));
    expect(first.isNew).toBe(true);
    expect(second.isNew).toBe(false);
    expect(second.state.items).toHaveLength(1);
    expect(second.state.items[0].count).toBe(2);
    const later = addNotice(second.state, notice({ id: 'n3', at: 1_000_000 }));
    expect(later.state.items).toHaveLength(2);
  });

  it('tracks unread, read-all, filters and clear', () => {
    let state = addNotice(EMPTY_NOTIFICATIONS, notice({ level: 'alert', text: 'A precisa', agentId: 'x' })).state;
    state = addNotice(state, notice({ id: 'n2', text: 'Mensagem entregue' })).state;
    expect(unreadCount(state)).toBe(2);
    expect(filterItems(state.items, 'alerts')).toHaveLength(1);
    expect(filterItems(state.items, 'messages')).toHaveLength(1);
    state = markAllRead(state);
    expect(unreadCount(state)).toBe(0);
    expect(clearAll(state).items).toEqual([]);
  });

  it('keeps a grouped delivery as a single updating entry', () => {
    const entry = { key: 'g', at: 1, level: 'info' as const, kind: 'message' as const, text: 'Equipe: 1 de 3 entregue' };
    let state = upsertGrouped(EMPTY_NOTIFICATIONS, entry).state;
    state = markAllRead(state);
    state = upsertGrouped(state, { ...entry, at: 2, text: 'Equipe: 2 de 3 entregues' }).state;
    expect(state.items).toHaveLength(1);
    expect(state.items[0].text).toBe('Equipe: 2 de 3 entregues');
    expect(state.items[0].read).toBe(false);
  });

  it('only lets alerts through when do-not-disturb is on', () => {
    const dnd = setDnd(EMPTY_NOTIFICATIONS, true);
    expect(shouldInterrupt(dnd, 'info')).toBe(false);
    expect(shouldInterrupt(dnd, 'alert')).toBe(true);
    expect(shouldInterrupt(EMPTY_NOTIFICATIONS, 'info')).toBe(true);
  });
});

describe('toasts', () => {
  it('dedupes with a counter and expires non-alerts', () => {
    let toasts = pushToast([], notice({ id: 'a' }), 0);
    toasts = pushToast(toasts, notice({ id: 'b' }), 1_000);
    expect(toasts).toHaveLength(1);
    expect(toasts[0].count).toBe(2);
    expect(expireToasts(toasts, 3_000)).toHaveLength(1);
    expect(expireToasts(toasts, 10_000)).toHaveLength(0);
  });

  it('keeps alerts until their agent stops waiting (after a grace period)', () => {
    const toasts = pushToast([], notice({ level: 'alert', agentId: 'ag1', text: 'Precisa' }), 0);
    expect(expireToasts(toasts, 1_000_000)).toHaveLength(1);
    const waiting = [agent({ id: 'ag1', status: 'waiting' })];
    const working = [agent({ id: 'ag1', status: 'working' })];
    expect(resolveAlertToasts(toasts, working, 1_000)).toHaveLength(1);
    expect(resolveAlertToasts(toasts, waiting, 60_000)).toHaveLength(1);
    expect(resolveAlertToasts(toasts, working, 60_000)).toHaveLength(0);
  });

  it('caps the stack, dropping expirable toasts first', () => {
    let toasts = pushToast([], notice({ id: 'alert', level: 'alert', text: 'A' }), 0);
    for (let i = 0; i < 5; i++) toasts = pushToast(toasts, notice({ id: `i${i}`, text: `t${i}` }), 0);
    expect(toasts).toHaveLength(4);
    expect(toasts[0].id).toBe('alert');
  });
});

describe('terminal model', () => {
  const entries: TranscriptEntry[] = [
    { kind: 'user', at: 1, text: 'Rode os testes' },
    { kind: 'assistant', at: 2, text: 'Rodando testes agora. Testes ok.' },
    { kind: 'tool', at: 3, id: 't', name: 'Bash', summary: 'npm test', result: 'ok\nTESTES passaram' },
    { kind: 'thinking', at: 4, text: 'nada' },
  ];

  it('finds case-insensitive matches in order', () => {
    const matches = findMatches(entries, 'testes');
    expect(matches.map((m) => `${m.entryIndex}.${m.occurrence}`)).toEqual(['0.0', '1.0', '1.1', '2.0']);
    expect(findMatches(entries, '   ')).toEqual([]);
    expect(entrySearchText(entries[2])).toContain('npm test');
  });

  it('steps through matches with wrap-around', () => {
    expect(stepMatch(3, 2, 1)).toBe(0);
    expect(stepMatch(3, 0, -1)).toBe(2);
    expect(stepMatch(3, -1, 1)).toBe(0);
    expect(stepMatch(3, -1, -1)).toBe(2);
    expect(stepMatch(0, -1, 1)).toBe(-1);
  });

  it('splits highlights and code fences', () => {
    expect(splitHighlight('abcAbc', 'abc').map((p) => `${p.text}:${p.match}`)).toEqual(['abc:0', 'Abc:1']);
    expect(splitHighlight('xyz', 'q')).toEqual([{ text: 'xyz', match: -1 }]);
    const blocks = splitFences('Antes\n```ts\nconst a = 1;\n```\nDepois');
    expect(blocks).toEqual([
      { kind: 'text', text: 'Antes' },
      { kind: 'code', text: 'const a = 1;', lang: 'ts' },
      { kind: 'text', text: 'Depois' },
    ]);
    expect(splitFences('```\nabrir')[0].kind).toBe('code');
  });

  it('previews long tool results', () => {
    expect(toolPreview('a\nb\nc\nd\ne')).toEqual({ preview: 'a\nb\nc', hiddenLines: 2 });
    expect(toolPreview(undefined)).toEqual({ preview: '', hiddenLines: 0 });
  });

  it('merges incremental transcript pages only when they continue the state', () => {
    const full = mergeTranscript({ entries: [], next: 0, open: true }, { entries: entries.slice(0, 2), next: 2, open: true }, 0);
    expect(full.entries).toHaveLength(2);
    const more = mergeTranscript(full, { entries: entries.slice(2), next: 4, open: true }, 2);
    expect(more.entries).toHaveLength(4);
    expect(more.next).toBe(4);
    expect(mergeTranscript(more, { entries: [entries[0]], next: 9, open: true }, 2)).toBe(more);
    const closed = mergeTranscript(more, { entries: [], next: 4, open: false }, 4);
    expect(closed.open).toBe(false);
  });
});

describe('aggregateDay', () => {
  const ms = (working: number, waiting: number, idle: number) => ({ working, waiting, idle, done: 0, offline: 0 });

  it('sums totals, sorts by work time and scales bars to the longest row', () => {
    const view = aggregateDay({
      date: '2026-10-19',
      agents: [
        { agentId: 'a', name: 'Ana', projectId: 'p', ms: ms(60_000, 0, 60_000) },
        { agentId: 'b', name: 'Bruno', projectId: 'p', ms: ms(120_000, 30_000, 0) },
        { agentId: 'c', name: 'Caio', projectId: 'p', ms: ms(0, 0, 0) },
      ],
    });
    expect(view.rows.map((r) => r.name)).toEqual(['Bruno', 'Ana']);
    expect(view.totals).toEqual({ working: 180_000, waiting: 30_000, idle: 60_000 });
    expect(view.totalMs).toBe(270_000);
    expect(view.rows[0].segments[0].widthPct).toBeCloseTo(80);
    expect(view.rows[1].segments[0].widthPct).toBeCloseTo(40);
  });

  it('ignores invalid numbers', () => {
    const view = aggregateDay({ date: 'd', agents: [{ agentId: 'a', name: 'A', projectId: 'p', ms: { working: Number.NaN, waiting: -5, idle: 10, done: 0, offline: 0 } }] });
    expect(view.totals).toEqual({ working: 0, waiting: 0, idle: 10 });
  });
});

describe('messages in other languages', () => {
  const ctx = { nameOf: (id: string) => (id === '1' ? 'Ana' : 'Bruno'), teamLabel: 'loja' };
  const team = [message({ id: 'a', agentId: '1', group: 'g', status: 'delivered' }), message({ id: 'b', agentId: '2', group: 'g' })];

  it('labels statuses and deliveries in English', () => {
    setLocale('en');
    expect(messageStatusLabel(message())).toBe('Queued');
    expect(messageStatusLabel(message({ status: 'delivered', via: 'stop' }))).toBe('Delivered as a new instruction');
    expect(summarizeDelivery([message({ agentId: '1', status: 'delivered', via: 'tool' })], ctx)?.text).toBe('Ana received your message while working.');
    expect(summarizeDelivery(team, ctx)?.text).toBe('Team loja: 1 of 2 delivered');
    expect(validateMessageText('   ')).toEqual({ ok: false, error: 'Write a message before sending.' });
  });

  it('labels statuses and deliveries in Spanish with the right plurals', () => {
    setLocale('es');
    expect(messageStatusLabel(message({ status: 'expired' }))).toBe('Expiró');
    expect(summarizeDelivery(team, ctx)?.text).toBe('Equipo loja: 1 de 2 entregado');
    const done = team.map((m) => ({ ...m, status: 'delivered' as const }));
    expect(summarizeDelivery(done, ctx)?.text).toBe('Equipo loja: 2 de 2 entregados');
  });

  it('keeps the source text of a notice and its localizable message together', () => {
    const state = addNotice(EMPTY_NOTIFICATIONS, notice({ text: 'Ana chegou', msg: { key: 'notice.arrived', params: { name: 'Ana', project: 'loja' } } })).state;
    expect(state.items[0].msg).toEqual({ key: 'notice.arrived', params: { name: 'Ana', project: 'loja' } });
    expect(state.items[0].text).toBe('Ana chegou');
  });

  it('recognizes message notices written in any language', () => {
    expect(classifyNotice(notice({ text: 'Message delivered to Ana' }))).toBe('message');
    expect(classifyNotice(notice({ text: 'Mensaje entregado a Ana' }))).toBe('message');
    expect(classifyNotice(notice({ text: 'Ana joined' }))).toBe('info');
  });
});
