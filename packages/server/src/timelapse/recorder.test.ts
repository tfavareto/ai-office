import { describe, expect, test } from 'vitest';
import { parseLine } from '../claude/line-parser';
import type { DayWindow } from '../report/accumulator';
import { T0, assistantLine, text, toolResultLine, toolUse, userLine } from '../test-helpers';
import { ACTIVITY_GAP_MS, TraceRecorder, type TraceEvent } from './recorder';

const HOUR = 3_600_000;
const MIN = 60_000;
const SEC = 1000;
const WINDOW: DayWindow = { start: T0 - 6 * HOUR, end: T0 + 18 * HOUR };

function record(lines: string[], isSub = false, window: DayWindow = WINDOW, maxEvents?: number) {
  const recorder = new TraceRecorder(window, isSub, maxEvents);
  for (const raw of lines) {
    const parsed = parseLine(raw);
    if (parsed !== undefined) recorder.ingest(parsed);
  }
  return recorder.result();
}

const call = (id: string, name: string, input: Record<string, unknown>, at: number): string =>
  assistantLine([toolUse(id, name, input)], at);
const endTurn = (at: number): string => assistantLine([text('pronto')], at, { stopReason: 'end_turn' });

const statuses = (events: readonly TraceEvent[]) =>
  events.filter((event) => event.t === 'status').map((event) => [event.at - T0, event.status]);
const kinds = (events: readonly TraceEvent[], t: TraceEvent['t']) => events.filter((event) => event.t === t);

describe('status derivation', () => {
  test('a prompt starts the work and the end of the turn rests', () => {
    const trace = record([
      userLine('faça isso', 0),
      call('r1', 'Read', { file_path: '/work/proj/a.ts' }, 2 * SEC),
      toolResultLine('r1', 'ok', 3 * SEC),
      endTurn(10 * SEC),
    ]);

    expect(statuses(trace.events)).toEqual([
      [0, 'working'],
      [10 * SEC, 'idle'],
    ]);
  });

  test('an edit that stays pending past 8 seconds is a permission wait, and answering it resumes the work', () => {
    const trace = record([
      userLine('edite', 0),
      call('e1', 'Edit', { file_path: '/work/proj/a.ts' }, 1 * SEC),
      toolResultLine('e1', 'ok', 61 * SEC),
      endTurn(70 * SEC),
    ]);

    expect(statuses(trace.events)).toEqual([
      [0, 'working'],
      [9 * SEC + 1, 'waiting'],
      [61 * SEC, 'working'],
      [70 * SEC, 'idle'],
    ]);
    const wait = trace.events.find((event) => event.t === 'status' && event.status === 'waiting');
    expect(wait).toMatchObject({
      waitingFor: 'Aprovar Edit',
      waitingForMsg: { key: 'waiting.approve', params: { tool: 'Edit' } },
    });
    expect(trace.events.filter((event) => event.t === 'permission')).toEqual([
      { at: T0 + 9 * SEC + 1, t: 'permission', tool: 'Edit', durationMs: 61 * SEC - (9 * SEC + 1) },
    ]);
  });

  test('a short wait is a status but gets no marker', () => {
    const trace = record([
      userLine('edite', 0),
      call('e1', 'Edit', { file_path: '/work/proj/a.ts' }, 1 * SEC),
      toolResultLine('e1', 'ok', 14 * SEC),
      endTurn(16 * SEC),
    ]);

    expect(statuses(trace.events).map(([, status]) => status)).toEqual(['working', 'waiting', 'working', 'idle']);
    expect(trace.events.some((event) => event.t === 'permission')).toBe(false);
  });

  test('a long Bash command is a shell, never a permission wait', () => {
    const trace = record([
      userLine('rode', 0),
      call('b1', 'Bash', { command: 'npm run build' }, 1 * SEC),
      toolResultLine('b1', 'ok', 3 * MIN),
      endTurn(3 * MIN + SEC),
    ]);

    expect(statuses(trace.events).map(([, status]) => status)).toEqual(['working', 'idle']);
    expect(kinds(trace.events, 'shell')).toMatchObject([
      { at: T0 + 11 * SEC, on: true, background: false },
      { at: T0 + 3 * MIN, on: false },
    ]);
  });

  test('a question for the person is a wait until it is answered', () => {
    const trace = record([
      userLine('pergunte', 0),
      call('q1', 'AskUserQuestion', { questions: [] }, 1 * SEC),
      toolResultLine('q1', 'resposta', 5 * MIN),
      endTurn(5 * MIN + SEC),
    ]);

    const wait = trace.events.find((event) => event.t === 'status' && event.status === 'waiting');
    expect(wait).toMatchObject({ at: T0 + 1 * SEC, waitingForMsg: { key: 'waiting.answerQuestion' } });
    expect(trace.events.find((event) => event.t === 'permission')).toMatchObject({
      tool: 'AskUserQuestion',
      durationMs: 5 * MIN - 1 * SEC,
    });
  });

  test('a turn with no event for ten minutes counts as finished, like the live engine without a registry', () => {
    const trace = record([
      userLine('trabalhe', 0),
      call('r1', 'Read', { file_path: '/work/proj/a.ts' }, 1 * SEC),
      toolResultLine('r1', 'ok', 2 * SEC),
      userLine('de novo', 40 * MIN),
    ]);

    expect(statuses(trace.events)).toEqual([
      [0, 'working'],
      [2 * SEC + 10 * MIN + 1, 'idle'],
      [40 * MIN, 'working'],
    ]);
  });

  test('a wait still open at the last line is reported so far', () => {
    const trace = record([
      userLine('edite', 0),
      call('e1', 'Edit', { file_path: '/work/proj/a.ts' }, 1 * SEC),
      assistantLine([text('ainda aqui')], 2 * MIN),
    ]);

    expect(trace.events.filter((event) => event.t === 'permission')).toHaveLength(1);
    expect(record([userLine('x', 0)]).events.filter((event) => event.t === 'permission')).toHaveLength(0);
  });
});

describe('what the agent was doing', () => {
  test('keeps the kind, icon and a localizable message of tool calls', () => {
    const trace = record([userLine('leia', 0), call('r1', 'Read', { file_path: '/work/proj/src/app.ts' }, 2 * SEC)]);

    const read = trace.events.find((event) => event.t === 'activity' && event.kind === 'read');
    expect(read).toMatchObject({
      icon: '📖',
      text: 'Lendo app.ts',
      msg: { key: 'activity.read', params: { file: 'app.ts' } },
    });
  });

  test('coalesces rapid ordinary activities but keeps the ones that tell the story', () => {
    const lines = [userLine('trabalhe', 0)];
    for (let i = 0; i < 10; i++) lines.push(call(`r${i}`, 'Read', { file_path: `/work/proj/f${i}.ts` }, (i + 1) * SEC));
    lines.push(call('t1', 'Agent', { description: 'Explorar', subagent_type: 'Explore' }, 11 * SEC), endTurn(12 * SEC));
    const trace = record(lines);

    const activities = trace.events.filter((event) => event.t === 'activity');
    expect(activities.filter((event) => event.kind === 'read')).toHaveLength(2);
    for (const kind of ['prompt', 'subagent', 'done'])
      expect(
        activities.some((event) => event.kind === kind),
        kind,
      ).toBe(true);
  });

  test('lets an ordinary activity through once the gap has passed and drops exact repeats', () => {
    const trace = record([
      userLine('trabalhe', 0),
      call('r1', 'Read', { file_path: '/work/proj/a.ts' }, 1 * SEC),
      call('r2', 'Read', { file_path: '/work/proj/a.ts' }, 2 * SEC + ACTIVITY_GAP_MS),
      call('r3', 'Read', { file_path: '/work/proj/b.ts' }, 3 * SEC + 2 * ACTIVITY_GAP_MS),
    ]);

    expect(
      trace.events
        .filter((event) => event.t === 'activity' && event.kind === 'read')
        .map((event) => (event.t === 'activity' ? event.text : '')),
    ).toEqual(['Lendo a.ts', 'Lendo b.ts']);
  });

  test('stops adding ordinary activities when the file budget is spent and says so', () => {
    const lines = [userLine('trabalhe', 0)];
    for (let i = 0; i < 300; i++)
      lines.push(
        call(`r${i}`, 'Read', { file_path: `/work/proj/f${i}.ts` }, (i + 1) * 60 * SEC),
        toolResultLine(`r${i}`, 'ok', (i + 1) * 60 * SEC + 500),
      );
    lines.push(endTurn(400 * 60 * SEC));
    const trace = record(lines, false, { start: T0 - HOUR, end: T0 + 500 * HOUR }, 100);

    expect(trace.events.length).toBeLessThanOrEqual(110);
    expect(trace.thinned).toBe(true);
    expect(trace.events.some((event) => event.t === 'status' && event.status === 'idle')).toBe(true);
  });

  test('tracks the task list as it changes', () => {
    const trace = record([
      userLine('planeje', 0),
      call(
        'w1',
        'TodoWrite',
        {
          todos: [
            { content: 'Escrever testes', status: 'in_progress', activeForm: 'Escrevendo testes' },
            { content: 'Publicar', status: 'pending' },
          ],
        },
        2 * SEC,
      ),
      call(
        'w2',
        'TodoWrite',
        {
          todos: [
            { content: 'Escrever testes', status: 'completed' },
            { content: 'Publicar', status: 'in_progress' },
          ],
        },
        30 * SEC,
      ),
    ]);

    const lists = trace.events.filter((event) => event.t === 'tasks');
    expect(lists).toHaveLength(2);
    expect(lists[0]).toMatchObject({
      tasks: [
        { title: 'Escrever testes', status: 'in_progress', activeForm: 'Escrevendo testes' },
        { title: 'Publicar', status: 'pending' },
      ],
    });
    expect(lists[1]).toMatchObject({ tasks: [{ status: 'completed' }, { status: 'in_progress' }] });
  });

  test('follows background shells from start to the notice that ends them', () => {
    const trace = record([
      userLine('suba o servidor', 0),
      call('b1', 'Bash', { command: 'npm run dev', run_in_background: true }, 2 * SEC),
      toolResultLine('b1', 'started', 3 * SEC, { toolUseResult: { backgroundTaskId: 'bg1' } }),
      call('k1', 'KillShell', { shell_id: 'bg1' }, 5 * MIN),
    ]);

    expect(trace.events.filter((event) => event.t === 'shell')).toMatchObject([
      { on: true, background: true, at: T0 + 2 * SEC },
      { on: false, at: T0 + 5 * MIN },
    ]);
  });
});

describe('privacy', () => {
  test('never keeps the text of a prompt, a reply, a tool result or a title-less first prompt', () => {
    const trace = record([
      userLine('a senha do cliente é hunter2 e o segredo é azul', 0),
      assistantLine([text('Vou usar o segredo azul no código')], 1 * SEC),
      call('r1', 'Read', { file_path: '/work/proj/a.ts' }, 2 * SEC),
      toolResultLine('r1', 'conteúdo confidencial do arquivo', 3 * SEC, {}, true),
      endTurn(4 * SEC),
    ]);

    const json = JSON.stringify(trace);
    expect(json).not.toMatch(/hunter2|segredo|confidencial/);
    expect(trace.events.find((event) => event.t === 'activity' && event.kind === 'prompt')).toMatchObject({
      text: 'Nova tarefa',
      msg: { key: 'timelapse.activity.prompt' },
    });
    expect(trace.title).toBeUndefined();
  });

  test('masks credentials that appear in a command', () => {
    const trace = record([
      userLine('rode', 0),
      call(
        'b1',
        'Bash',
        { command: 'curl -H "Authorization: Bearer abc123secretvalue" --token=s3cr3t https://x.test', description: '' },
        2 * SEC,
      ),
    ]);

    const bash = trace.events.find((event) => event.t === 'activity' && event.kind === 'bash');
    expect(JSON.stringify(bash)).not.toMatch(/abc123secretvalue|s3cr3t/);
  });
});

describe('presence and spawns', () => {
  test('splits the day into spans wherever events are more than 30 minutes apart', () => {
    const trace = record([
      userLine('a', 0),
      endTurn(1 * MIN),
      userLine('b', 20 * MIN),
      endTurn(21 * MIN),
      userLine('c', 3 * HOUR),
      endTurn(3 * HOUR + MIN),
    ]);

    expect(trace.spans).toEqual([
      { from: T0, to: T0 + 21 * MIN },
      { from: T0 + 3 * HOUR, to: T0 + 3 * HOUR + MIN },
    ]);
    expect([trace.firstAt, trace.lastAt]).toEqual([T0, T0 + 3 * HOUR + MIN]);
  });

  test('ignores lines outside the day and reports the custom title', () => {
    const trace = record([
      userLine('antes', -10 * HOUR),
      JSON.stringify({ type: 'custom-title', customTitle: 'Meu título' }),
      userLine('dentro', 0),
      userLine('depois', 20 * HOUR),
    ]);

    expect(trace.firstAt).toBe(T0);
    expect(trace.lastAt).toBe(T0);
    expect(trace.title).toBe('Meu título');
  });

  test('lists the subagent calls with the moment their result came back', () => {
    const trace = record([
      userLine('delegue', 0),
      call('a1', 'Agent', { description: 'Explorar', subagent_type: 'Explore' }, 2 * SEC),
      toolResultLine('a1', 'feito', 90 * SEC),
    ]);

    expect(trace.spawns).toEqual([
      { toolUseId: 'a1', at: T0 + 2 * SEC, doneAt: T0 + 90 * SEC, description: 'Explorar', subagentType: 'Explore' },
    ]);
  });
});
