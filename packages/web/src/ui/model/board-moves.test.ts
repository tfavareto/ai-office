import { afterEach, describe, expect, it } from 'vitest';
import { LOCALES } from '@ai-office/shared';
import { setLocale } from '../../i18n';
import type { BoardCard, BoardColumnId } from './board';
import { buildAddIntent, buildMoveIntent, markFromIntent, reconcileSent, SENT_TTL_MS, type SentMark } from './board-moves';

const card = (status: BoardColumnId, patch: Partial<BoardCard> = {}): BoardCard => ({
  key: 'ana:1',
  agentId: 'ana',
  taskId: '1',
  projectId: 'p1',
  accountId: 'acc1',
  status,
  label: 'Write the tests',
  title: 'Write the tests',
  index: 0,
  ...patch,
});
const nameOf = (id: string): string => (id === 'ana' ? 'Ana' : 'Bia');

afterEach(() => setLocale('pt-BR'));

describe('buildMoveIntent between columns', () => {
  it.each([
    ['pending', 'in_progress', 'start', 'Priorize agora a tarefa: Write the tests'],
    ['pending', 'completed', 'complete', 'Pode marcar como concluída a tarefa: Write the tests, se já terminou.'],
    ['in_progress', 'completed', 'complete', 'Pode marcar como concluída a tarefa: Write the tests, se já terminou.'],
    ['in_progress', 'pending', 'pause', 'Deixe a tarefa para depois e volte a ela mais tarde: Write the tests'],
    ['completed', 'pending', 'reopen', 'Reabra a tarefa e deixe como pendente: Write the tests'],
    ['completed', 'in_progress', 'resume', 'Reabra e retome agora a tarefa: Write the tests'],
  ] as const)('%s to %s asks the owner to %s', (from, to, kind, text) => {
    const intent = buildMoveIntent(card(from), { column: to }, nameOf);

    expect(intent).toMatchObject({ kind, recipientId: 'ana', text, column: to, cardKey: 'ana:1', baseStatus: from, title: 'Write the tests' });
  });

  it('does nothing when the card stays where it is', () => {
    expect(buildMoveIntent(card('pending'), { column: 'pending' }, nameOf)).toBeNull();
  });

  it('never moves a ghost card', () => {
    expect(buildMoveIntent(card('pending', { ghost: true }), { column: 'in_progress' }, nameOf)).toBeNull();
  });

  it('speaks the active language', () => {
    setLocale('en');
    const english = buildMoveIntent(card('pending'), { column: 'in_progress' }, nameOf);
    setLocale('es');
    const spanish = buildMoveIntent(card('pending'), { column: 'in_progress' }, nameOf);

    expect(english?.text).toBe('Prioritize this task now: Write the tests');
    expect(spanish?.text).toBe('Prioriza ahora esta tarea: Write the tests');
  });
});

describe('buildMoveIntent to another agent', () => {
  it('hands a pending task over and says where it came from', () => {
    const intent = buildMoveIntent(card('pending'), { agentId: 'bia' }, nameOf);

    expect(intent).toMatchObject({ kind: 'reassign', recipientId: 'bia', column: 'pending', text: 'Assuma a tarefa: Write the tests (veio de Ana)' });
  });

  it('asks to prioritize when the task was in progress', () => {
    const intent = buildMoveIntent(card('in_progress'), { agentId: 'bia' }, nameOf);

    expect(intent?.text).toBe('Assuma e priorize agora a tarefa: Write the tests (veio de Ana)');
    expect(intent?.column).toBe('in_progress');
  });

  it('refuses to hand over a completed task or to the same agent', () => {
    expect(buildMoveIntent(card('completed'), { agentId: 'bia' }, nameOf)).toBeNull();
    expect(buildMoveIntent(card('pending'), { agentId: 'ana' }, nameOf)).toBeNull();
  });
});

describe('buildAddIntent', () => {
  it('asks the agent to add the task, with wording that follows the column', () => {
    expect(buildAddIntent('ana', 'pending', '  Write docs  ')).toMatchObject({ kind: 'add', recipientId: 'ana', title: 'Write docs', column: 'pending', text: 'Adicione à sua lista de tarefas: Write docs' });
    expect(buildAddIntent('ana', 'in_progress', 'Write docs')?.text).toBe('Adicione à sua lista de tarefas e comece agora: Write docs');
    expect(buildAddIntent('ana', 'completed', 'Write docs')?.text).toBe('Registre na sua lista de tarefas, já como concluída: Write docs');
  });

  it('ignores an empty title', () => {
    expect(buildAddIntent('ana', 'pending', '   ')).toBeNull();
  });
});

describe('messages in every language', () => {
  it('fill the task and the origin without leftovers', () => {
    for (const locale of LOCALES) {
      setLocale(locale);
      const texts = [
        buildMoveIntent(card('pending'), { column: 'in_progress' }, nameOf),
        buildMoveIntent(card('in_progress'), { column: 'completed' }, nameOf),
        buildMoveIntent(card('in_progress'), { column: 'pending' }, nameOf),
        buildMoveIntent(card('completed'), { column: 'pending' }, nameOf),
        buildMoveIntent(card('completed'), { column: 'in_progress' }, nameOf),
        buildMoveIntent(card('in_progress'), { agentId: 'bia' }, nameOf),
        buildAddIntent('ana', 'completed', 'Write the tests'),
      ].map((intent) => intent?.text ?? '');
      for (const text of texts) {
        expect(text, locale).toContain('Write the tests');
        expect(text, locale).not.toMatch(/[{}]|board\.msg/);
      }
    }
  });
});

describe('reconcileSent', () => {
  const NOW = 1_000_000;
  const mark = (patch: Partial<SentMark>): SentMark => ({ id: 'm1', kind: 'start', agentId: 'ana', cardKey: 'ana:1', baseStatus: 'pending', title: 'Write the tests', column: 'in_progress', sentAt: NOW - 1000, ...patch });

  it('keeps a mark while the card still has the status it had when the message was sent', () => {
    const marks = [mark({})];

    expect(reconcileSent(marks, [card('pending')], NOW)).toBe(marks);
  });

  it('drops the mark once the card changed status or disappeared', () => {
    expect(reconcileSent([mark({})], [card('in_progress')], NOW)).toEqual([]);
    expect(reconcileSent([mark({})], [], NOW)).toEqual([]);
  });

  it('drops an add mark when the agent has a task with that title, ignoring case and spacing', () => {
    const add = mark({ kind: 'add', cardKey: undefined, baseStatus: undefined, title: 'Write  Docs' });

    expect(reconcileSent([add], [card('pending', { title: 'write docs' })], NOW)).toEqual([]);
    expect(reconcileSent([add], [card('pending', { agentId: 'bia', title: 'write docs' })], NOW)).toEqual([add]);
  });

  it('drops a hand-over once the new owner lists the task, even if the old card is still there', () => {
    const handOver = mark({ kind: 'reassign', agentId: 'bia' });

    expect(reconcileSent([handOver], [card('pending'), card('pending', { key: 'bia:9', agentId: 'bia' })], NOW)).toEqual([]);
    expect(reconcileSent([handOver], [card('pending')], NOW)).toEqual([handOver]);
  });

  it('gives up on a mark after ten minutes', () => {
    const old = mark({ sentAt: NOW - SENT_TTL_MS - 1 });

    expect(reconcileSent([old], [card('pending')], NOW)).toEqual([]);
  });
});

describe('markFromIntent', () => {
  it('keeps what is needed to follow the request', () => {
    const intent = buildMoveIntent(card('pending'), { column: 'in_progress' }, nameOf);

    expect(markFromIntent(intent!, 'm9', 5)).toEqual({ id: 'm9', kind: 'start', agentId: 'ana', title: 'Write the tests', column: 'in_progress', cardKey: 'ana:1', baseStatus: 'pending', sentAt: 5 });
  });
});
