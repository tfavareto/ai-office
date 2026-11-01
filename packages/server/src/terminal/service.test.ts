import { describe, expect, test } from 'vitest';
import { ByteRing } from './ring';
import { MAX_COLS, MAX_ROWS, MAX_TERMINALS, TerminalService, type PtyProcess, type PtySpawner } from './service';

interface FakePty extends PtyProcess {
  written: string[];
  killed: boolean;
  signals: (string | undefined)[];
  size: { cols: number; rows: number };
  emit(text: string): void;
  exit(code: number): void;
}

function fakeSpawner(): { spawner: PtySpawner; last: () => FakePty; calls: Parameters<PtySpawner>[] } {
  const calls: Parameters<PtySpawner>[] = [];
  let latest: FakePty | undefined;
  let nextPid = 1000;
  const spawner: PtySpawner = (...args) => {
    calls.push(args);
    let onData: (data: Buffer) => void = () => undefined;
    let onExit: (code: number) => void = () => undefined;
    const pty: FakePty = {
      pid: nextPid++,
      written: [],
      killed: false,
      signals: [],
      size: { cols: args[3].cols, rows: args[3].rows },
      write: (data) => pty.written.push(data),
      resize: (cols, rows) => {
        pty.size = { cols, rows };
      },
      kill: (signal) => {
        pty.killed = true;
        pty.signals.push(signal);
      },
      onData: (listener) => {
        onData = listener;
      },
      onExit: (listener) => {
        onExit = listener;
      },
      emit: (text) => onData(Buffer.from(text)),
      exit: (code) => onExit(code),
    };
    latest = pty;
    return pty;
  };
  return { spawner, calls, last: () => latest as FakePty };
}

const spec = { file: '/bin/claude', args: ['--model', 'opus'], cwd: '/work/p', env: {}, cols: 100, rows: 30 };

function service(spawner: PtySpawner | null) {
  let ids = 0;
  let clock = 1000;
  const events: unknown[] = [];
  const terminals = new TerminalService({
    spawner: () => spawner,
    now: () => clock,
    newId: () => `t${++ids}`,
    stopGraceMs: 0,
  });
  terminals.subscribe((event) => events.push(event));
  return { terminals, events, tick: (ms: number) => (clock += ms) };
}

describe('ByteRing', () => {
  test('keeps what was written while it fits', () => {
    // Arrange
    const ring = new ByteRing(10);

    // Act
    ring.append(Buffer.from('abc'));
    ring.append(Buffer.from('de'));

    // Assert
    expect(ring.snapshot().toString()).toBe('abcde');
  });

  test('keeps only the newest bytes when it overflows', () => {
    // Arrange
    const ring = new ByteRing(4);

    // Act
    ring.append(Buffer.from('abc'));
    ring.append(Buffer.from('defg'));

    // Assert
    expect(ring.snapshot().toString()).toBe('defg');
  });

  test('a single chunk larger than the ring keeps its tail', () => {
    // Arrange
    const ring = new ByteRing(3);

    // Act
    ring.append(Buffer.from('abcdef'));

    // Assert
    expect(ring.snapshot().toString()).toBe('def');
  });
});

describe('TerminalService', () => {
  test('starts the program it was given, with no shell, and lists it', () => {
    // Arrange
    const { spawner, calls, last } = fakeSpawner();
    const { terminals } = service(spawner);

    // Act
    const info = terminals.start(spec);

    // Assert
    expect(calls[0]?.[0]).toBe('/bin/claude');
    expect(calls[0]?.[1]).toEqual(['--model', 'opus']);
    expect(calls[0]?.[3]).toMatchObject({ cwd: '/work/p', cols: 100, rows: 30 });
    expect(terminals.list()).toEqual([info]);
    expect(terminals.idFor(last().pid)).toBe(info.id);
  });

  test('refuses to start when the terminal engine is not installed', () => {
    // Arrange
    const { terminals } = service(null);

    // Act and assert
    expect(() => terminals.start(spec)).toThrow('unavailable');
  });

  test('refuses more terminals than the limit', () => {
    // Arrange
    const { spawner } = fakeSpawner();
    const { terminals } = service(spawner);
    for (let index = 0; index < MAX_TERMINALS; index += 1) terminals.start(spec);

    // Act and assert
    expect(() => terminals.start(spec)).toThrow('too-many');
  });

  test('sends what the person types to the right terminal only', () => {
    // Arrange
    const { spawner, last } = fakeSpawner();
    const { terminals } = service(spawner);
    const first = terminals.start(spec);
    const firstPty = last();
    terminals.start(spec);
    const secondPty = last();

    // Act
    const sent = terminals.write(first.id, 'ls\r');

    // Assert
    expect(sent).toBe(true);
    expect(firstPty.written).toEqual(['ls\r']);
    expect(secondPty.written).toEqual([]);
  });

  test('says when there is no such terminal', () => {
    // Arrange
    const { spawner } = fakeSpawner();
    const { terminals } = service(spawner);

    // Act and assert
    expect(terminals.write('nope', 'x')).toBe(false);
    expect(terminals.resize('nope', 80, 24)).toBe(false);
    expect(terminals.kill('nope')).toBe(false);
  });

  test('keeps the grid within limits', () => {
    // Arrange
    const { spawner, last } = fakeSpawner();
    const { terminals } = service(spawner);
    const { id } = terminals.start(spec);

    // Act
    terminals.resize(id, 100_000, 100_000);
    const large = last().size;
    terminals.resize(id, 1, 1);
    const small = last().size;

    // Assert
    expect(large).toEqual({ cols: MAX_COLS, rows: MAX_ROWS });
    expect(small.cols).toBeGreaterThan(1);
    expect(small.rows).toBeGreaterThan(1);
  });

  test('numbers the output and replays it for whoever arrives later', () => {
    // Arrange
    const { spawner, last } = fakeSpawner();
    const { terminals, events } = service(spawner);
    const { id } = terminals.start(spec);

    // Act
    last().emit('hello ');
    last().emit('world');

    // Assert
    expect(events).toEqual([
      { kind: 'output', id, seq: 1, data: Buffer.from('hello ') },
      { kind: 'output', id, seq: 2, data: Buffer.from('world') },
    ]);
    expect(terminals.replay(id)).toEqual({ seq: 2, data: Buffer.from('hello world') });
  });

  test('tells when the program ended and keeps its output for a while', () => {
    // Arrange
    const { spawner, last } = fakeSpawner();
    const { terminals, events } = service(spawner);
    const { id } = terminals.start(spec);
    const { pid } = last();
    last().emit('bye');

    // Act
    last().exit(3);

    // Assert
    expect(events.at(-1)).toEqual({ kind: 'exit', id, code: 3 });
    expect(terminals.list()[0]?.exitCode).toBe(3);
    expect(terminals.replay(id)?.data.toString()).toBe('bye');
    expect(terminals.idFor(pid)).toBeUndefined();
    expect(terminals.write(id, 'x')).toBe(false);
  });

  test('an ended terminal is forgotten after its grace period and no longer counts', () => {
    // Arrange
    const { spawner, last } = fakeSpawner();
    const { terminals, tick } = service(spawner);
    const { id } = terminals.start(spec);
    last().exit(0);

    // Act
    tick(10 * 60_000);
    terminals.sweep();

    // Assert
    expect(terminals.replay(id)).toBeUndefined();
    expect(terminals.list()).toEqual([]);
  });

  test('stops every running program when the server stops', async () => {
    // Arrange
    const { spawner, last } = fakeSpawner();
    const { terminals } = service(spawner);
    terminals.start(spec);
    const pty = last();

    // Act
    await terminals.stopAll();

    // Assert
    expect(pty.killed).toBe(true);
  });

  test('a program that ignores the hang-up is forced to stop', async () => {
    // Arrange
    const { spawner, last } = fakeSpawner();
    const { terminals } = service(spawner);
    terminals.start(spec);
    const pty = last();

    // Act
    await terminals.stopAll();

    // Assert
    expect(pty.signals).toEqual([undefined, 'SIGKILL']);
  });

  test('a program that stopped by itself gets no second signal', async () => {
    // Arrange
    const { spawner, last } = fakeSpawner();
    const { terminals } = service(spawner);
    terminals.start(spec);
    const pty = last();
    pty.kill = (signal) => {
      pty.signals.push(signal);
      pty.exit(0);
    };

    // Act
    await terminals.stopAll();

    // Assert
    expect(pty.signals).toEqual([undefined]);
  });

  test('a program that cannot start fails clearly', () => {
    // Arrange
    const spawner: PtySpawner = () => {
      throw new Error('posix_spawnp failed');
    };
    const { terminals } = service(spawner);

    // Act and assert
    expect(() => terminals.start(spec)).toThrow('spawn-failed');
    expect(terminals.list()).toEqual([]);
  });
});
