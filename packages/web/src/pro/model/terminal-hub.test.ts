import { describe, expect, it } from 'vitest';
import {
  MAX_INPUT_CHARS,
  TerminalHub,
  chunkInput,
  orphanTerminals,
  type HubBackend,
  type TerminalSink,
} from './terminal-hub';

type Listener = (event: { data: string }) => void;

class FakeSource {
  readonly listeners = new Map<string, Listener>();
  closed = false;
  addEventListener(name: string, listener: Listener): void {
    this.listeners.set(name, listener);
  }
  close(): void {
    this.closed = true;
  }
  fire(name: string, data: unknown): void {
    this.listeners.get(name)?.({ data: JSON.stringify(data) });
  }
}

const b64 = (text: string): string => btoa(text);

function sink() {
  const log: string[] = [];
  const target: TerminalSink = {
    write: (bytes) => log.push(new TextDecoder().decode(bytes)),
    reset: () => log.push('<reset>'),
    ended: (code) => log.push(`<ended ${code}>`),
  };
  return { log, target };
}

function setup() {
  const sent: { id: string; data: string }[] = [];
  const pending: (() => void)[] = [];
  const backend: HubBackend = {
    terminalInput: (id, data) =>
      new Promise((resolve) => {
        sent.push({ id, data });
        pending.push(resolve);
      }),
    terminalResize: () => Promise.resolve(),
    terminalKill: () => Promise.resolve(),
  };
  const sources: FakeSource[] = [];
  const hub = new TerminalHub(backend, () => {
    const source = new FakeSource();
    sources.push(source);
    return source as unknown as EventSource;
  });
  return { hub, sent, pending, sources, finishSend: () => pending.shift()?.() };
}

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve));

describe('chunkInput', () => {
  it('keeps short text whole', () => {
    expect(chunkInput('abc')).toEqual(['abc']);
  });

  it('cuts a long paste in pieces the server accepts, without losing anything', () => {
    // Arrange
    const text = 'x'.repeat(MAX_INPUT_CHARS * 2 + 5);

    // Act
    const chunks = chunkInput(text);

    // Assert
    expect(chunks).toHaveLength(3);
    expect(chunks.join('')).toBe(text);
  });

  it('never cuts an emoji in half', () => {
    // Arrange
    const text = `${'x'.repeat(MAX_INPUT_CHARS - 1)}😀end`;

    // Act
    const chunks = chunkInput(text);

    // Assert
    expect(chunks[0]).toHaveLength(MAX_INPUT_CHARS - 1);
    expect(chunks[1]).toBe('😀end');
  });
});

describe('orphanTerminals', () => {
  const info = (id: string) => ({ id, cwd: '/w', cols: 80, rows: 24, startedAt: 0 });

  it('lists the terminals that have no session in the office yet', () => {
    // Arrange
    const terminals = [info('linked'), info('new')];

    // Act
    const orphans = orphanTerminals(terminals, new Set(['linked']), new Set());

    // Assert
    expect(orphans.map((terminal) => terminal.id)).toEqual(['new']);
  });

  it('leaves out the ones the person dismissed', () => {
    // Arrange
    const terminals = [info('gone')];

    // Act
    const orphans = orphanTerminals(terminals, new Set(), new Set(['gone']));

    // Assert
    expect(orphans).toEqual([]);
  });
});

describe('TerminalHub', () => {
  it('knows the terminals the stream announced, and tells when they change', () => {
    // Arrange
    const { hub, sources } = setup();
    let changes = 0;
    hub.onChange(() => (changes += 1));
    hub.connect();

    // Act
    sources[0]?.fire('terminal', { info: { id: 'a', cwd: '/w', cols: 80, rows: 24, startedAt: 1 }, seq: 0, data: '' });
    sources[0]?.fire('exit', { id: 'a', code: 1 });

    // Assert
    expect(hub.terminals()[0]).toMatchObject({ id: 'a', exitCode: 1 });
    expect(changes).toBe(2);
  });

  it('opens one stream only when the first terminal is attached', () => {
    // Arrange
    const { hub, sources } = setup();
    expect(sources).toHaveLength(0);

    // Act
    hub.attach('a', sink().target);
    hub.attach('b', sink().target);

    // Assert
    expect(sources).toHaveLength(1);
  });

  it('draws what the server replays and then what it prints', () => {
    // Arrange
    const { hub, sources } = setup();
    const { log, target } = sink();
    hub.attach('a', target);

    // Act
    sources[0]?.fire('terminal', { info: { id: 'a' }, seq: 2, data: b64('old') });
    sources[0]?.fire('output', { id: 'a', seq: 3, data: b64('new') });

    // Assert
    expect(log).toEqual(['<reset>', 'old', 'new']);
  });

  it('ignores output already in the replay', () => {
    // Arrange
    const { hub, sources } = setup();
    const { log, target } = sink();
    hub.attach('a', target);
    sources[0]?.fire('terminal', { info: { id: 'a' }, seq: 5, data: b64('all') });

    // Act
    sources[0]?.fire('output', { id: 'a', seq: 5, data: b64('dup') });

    // Assert
    expect(log).toEqual(['<reset>', 'all']);
  });

  it('a reconnection redraws from the new replay', () => {
    // Arrange
    const { hub, sources } = setup();
    const { log, target } = sink();
    hub.attach('a', target);
    sources[0]?.fire('terminal', { info: { id: 'a' }, seq: 1, data: b64('one') });

    // Act
    sources[0]?.fire('terminal', { info: { id: 'a' }, seq: 9, data: b64('all') });

    // Assert
    expect(log).toEqual(['<reset>', 'one', '<reset>', 'all']);
  });

  it('the announcement of a new terminal does not wipe what it already printed', () => {
    // Arrange
    const { hub, sources } = setup();
    const { log, target } = sink();
    hub.attach('a', target);
    sources[0]?.fire('output', { id: 'a', seq: 1, data: b64('first') });

    // Act
    sources[0]?.fire('terminal', { info: { id: 'a' }, seq: 0, data: '' });

    // Assert
    expect(log).toEqual(['first']);
  });

  it('a view attached later gets what was printed before', () => {
    // Arrange
    const { hub, sources } = setup();
    hub.attach('other', sink().target);
    sources[0]?.fire('output', { id: 'a', seq: 1, data: b64('before') });
    const { log, target } = sink();

    // Act
    hub.attach('a', target);

    // Assert
    expect(log).toEqual(['before']);
  });

  it('a view that detached stops receiving', () => {
    // Arrange
    const { hub, sources } = setup();
    const { log, target } = sink();
    const detach = hub.attach('a', target);

    // Act
    detach();
    sources[0]?.fire('output', { id: 'a', seq: 1, data: b64('later') });

    // Assert
    expect(log).toEqual([]);
  });

  it('keeps only the newest output in memory', () => {
    // Arrange
    const { hub, sources } = setup();
    hub.attach('other', sink().target);
    const big = 'x'.repeat(300 * 1024);
    for (let seq = 1; seq <= 3; seq += 1) sources[0]?.fire('output', { id: 'a', seq, data: b64(big) });
    const { log, target } = sink();

    // Act
    hub.attach('a', target);

    // Assert
    const total = log.reduce((sum, chunk) => sum + chunk.length, 0);
    expect(total).toBeLessThanOrEqual(600 * 1024);
    expect(total).toBeGreaterThan(0);
  });

  it('tells a view that the program ended, also when it attaches afterwards', () => {
    // Arrange
    const { hub, sources } = setup();
    const first = sink();
    hub.attach('a', first.target);

    // Act
    sources[0]?.fire('exit', { id: 'a', code: 2 });
    const second = sink();
    hub.attach('a', second.target);

    // Assert
    expect(first.log).toEqual(['<ended 2>']);
    expect(second.log).toEqual(['<ended 2>']);
  });

  it('sends keys in the order they were typed, one request at a time', async () => {
    // Arrange
    const { hub, sent, finishSend } = setup();

    // Act
    hub.send('a', 'l');
    hub.send('a', 's');
    hub.send('a', '\r');
    await flush();
    const whileWaiting = sent.map((entry) => entry.data);
    finishSend();
    await flush();

    // Assert
    expect(whileWaiting).toEqual(['l']);
    expect(sent.map((entry) => entry.data)).toEqual(['l', 's\r']);
  });

  it('opens a new stream when the last one was refused for good', () => {
    // Arrange: a browser does not retry a stream the server answered with an error.
    const { hub, sources } = setup();
    hub.connect();
    (sources[0] as unknown as { readyState: number }).readyState = 2;

    // Act
    hub.connect();

    // Assert
    expect(sources).toHaveLength(2);
  });

  it('keeps the stream that is still open', () => {
    // Arrange
    const { hub, sources } = setup();
    hub.connect();

    // Act
    hub.connect();

    // Assert
    expect(sources).toHaveLength(1);
  });

  it('closes the stream when the view goes away', () => {
    // Arrange
    const { hub, sources } = setup();
    hub.attach('a', sink().target);

    // Act
    hub.close();

    // Assert
    expect(sources[0]?.closed).toBe(true);
  });

  it('ignores events that are not valid', () => {
    // Arrange
    const { hub, sources } = setup();
    const { log, target } = sink();
    hub.attach('a', target);

    // Act
    sources[0]?.listeners.get('output')?.({ data: 'not json' });
    sources[0]?.fire('output', { id: 7 });

    // Assert
    expect(log).toEqual([]);
  });
});
