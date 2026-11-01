import { describe, expect, test } from 'vitest';
import { cleanMessage, formatDelivery } from './links';
import { TerminalService, type PtyProcess, type PtySpawner } from './service';

interface FakePty extends PtyProcess {
  written: string[];
  exit(code: number): void;
}

function setup() {
  const ptys: FakePty[] = [];
  let pid = 100;
  const spawner: PtySpawner = () => {
    let onExit: (code: number) => void = () => undefined;
    const pty: FakePty = {
      pid: pid++,
      written: [],
      write: (data) => pty.written.push(data),
      resize: () => undefined,
      kill: () => undefined,
      onData: () => undefined,
      onExit: (listener) => {
        onExit = listener;
      },
      exit: (code) => onExit(code),
    };
    ptys.push(pty);
    return pty;
  };
  let ids = 0;
  const terminals = new TerminalService({
    spawner: () => spawner,
    now: () => 1000,
    newId: () => `t${++ids}`,
    stopGraceMs: 0,
    pasteSettleMs: 0,
  });
  const start = (): string => terminals.start({ file: '/c', args: [], cwd: '/w', env: {}, cols: 80, rows: 24 }).id;
  return { terminals, ptys, start };
}

const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 5));

describe('cleanMessage', () => {
  test('keeps text, line breaks and tabs', () => {
    expect(cleanMessage('a\n\tb é')).toBe('a\n\tb é');
  });

  test('removes what a terminal would obey: an agent cannot press keys in another', () => {
    // Arrange: Esc, Ctrl+C, a carriage return and the end of a bracketed paste.
    const text = 'x\x1b[201~\x03go\ry\x7f';

    // Act
    const clean = cleanMessage(text);

    // Assert
    expect(clean).toBe('x[201~go y');
  });
});

describe('formatDelivery', () => {
  test('says who it is from, so the agent can answer', () => {
    expect(formatDelivery('Nova', 'Revise isto')).toBe('[Message from Nova, sent through AI Office] Revise isto');
  });
});

describe('connections', () => {
  test('connect two running terminals, in both directions', () => {
    // Arrange
    const { terminals, start } = setup();
    const a = start();
    const b = start();

    // Act
    const connected = terminals.connect(a, b);

    // Assert
    expect(connected).toBe(true);
    expect(terminals.peersOf(a)).toEqual([b]);
    expect(terminals.peersOf(b)).toEqual([a]);
  });

  test('a terminal cannot connect to itself or to one that does not exist', () => {
    // Arrange
    const { terminals, start } = setup();
    const a = start();

    // Act and assert
    expect(terminals.connect(a, a)).toBe(false);
    expect(terminals.connect(a, 'nope')).toBe(false);
    expect(terminals.peersOf(a)).toEqual([]);
  });

  test('can be undone', () => {
    // Arrange
    const { terminals, start } = setup();
    const a = start();
    const b = start();
    terminals.connect(a, b);

    // Act
    terminals.disconnect(b, a);

    // Assert
    expect(terminals.peersOf(a)).toEqual([]);
  });

  test('end when one of the programs ends', () => {
    // Arrange
    const { terminals, ptys, start } = setup();
    const a = start();
    const b = start();
    terminals.connect(a, b);

    // Act
    ptys[1]?.exit(0);

    // Assert
    expect(terminals.peersOf(a)).toEqual([]);
  });
});

describe('delivering a message', () => {
  test('pastes it into the connected terminal and presses Enter', async () => {
    // Arrange
    const { terminals, ptys, start } = setup();
    const a = start();
    const b = start();
    terminals.connect(a, b);

    // Act
    const sent = terminals.deliver(a, b, 'hello');
    await settle();

    // Assert
    expect(sent).toBe(true);
    expect(ptys[1]?.written).toEqual(['\x1b[200~hello\x1b[201~', '\r']);
    expect(ptys[0]?.written).toEqual([]);
  });

  test('refuses a terminal that is not connected', () => {
    // Arrange
    const { terminals, ptys, start } = setup();
    const a = start();
    const b = start();

    // Act
    const sent = terminals.deliver(a, b, 'hello');

    // Assert
    expect(sent).toBe(false);
    expect(ptys[1]?.written).toEqual([]);
  });
});

describe('starting a terminal', () => {
  test('tells the program its own terminal id, and keeps its role', () => {
    // Arrange
    const envs: NodeJS.ProcessEnv[] = [];
    const spawner: PtySpawner = (_file, _args, _name, options) => {
      envs.push(options.env);
      return {
        pid: 1,
        write: () => undefined,
        resize: () => undefined,
        kill: () => undefined,
        onData: () => undefined,
        onExit: () => undefined,
      };
    };
    const terminals = new TerminalService({ spawner: () => spawner, now: () => 1, newId: () => 'x1' });

    // Act
    const info = terminals.start({
      file: '/c',
      args: [],
      cwd: '/w',
      env: { A: '1' },
      cols: 80,
      rows: 24,
      role: 'Revisor',
    });

    // Assert
    expect(envs[0]).toMatchObject({ A: '1', AI_OFFICE_TERMINAL_ID: 'x1' });
    expect(info.role).toBe('Revisor');
  });
});
