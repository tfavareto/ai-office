// Terminals the office opens itself: real programs on real pseudo-terminals, drawn in the Pro view. The page never
// chooses what runs: `start` is only reached from a hire, with the `claude` executable and arguments built here on the
// server. What the page sends afterwards is what a person types, which is why every route around this is local-only.
import type { TerminalInfo } from '@ai-office/shared';
import { PASTE_END, PASTE_START, cleanMessage } from './links';
import { ByteRing } from './ring';

/** Programs running at once. */
export const MAX_TERMINALS = 16;
export const MIN_COLS = 20;
export const MAX_COLS = 400;
export const MIN_ROWS = 5;
export const MAX_ROWS = 200;
/** What a page gets to redraw a terminal it did not see: about ten screens of a busy TUI. */
const REPLAY_BYTES = 512 * 1024;
/** An ended terminal stays this long, so its last words can be read. */
const ENDED_LINGER_MS = 5 * 60_000;
const STOP_GRACE_MS = 500;
const PASTE_SETTLE_MS = 150;

export interface PtyProcess {
  readonly pid: number;
  write(data: string): void;
  resize(cols: number, rows: number): void;
  kill(signal?: string): void;
  onData(listener: (data: Buffer) => void): void;
  onExit(listener: (code: number) => void): void;
}

export interface PtyOptions {
  cwd: string;
  env: NodeJS.ProcessEnv;
  cols: number;
  rows: number;
}

export type PtySpawner = (file: string, args: readonly string[], name: string, options: PtyOptions) => PtyProcess;

export interface TerminalSpec {
  file: string;
  args: readonly string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  cols: number;
  rows: number;
  /** The name of the instructions it started with, to show on its title bar. */
  role?: string;
  /** What is needed to start it again later with `--resume`. */
  roleInstructions?: string | undefined;
  configDir?: string | undefined;
}

export type TerminalEvent =
  { kind: 'output'; id: string; seq: number; data: Buffer } | { kind: 'exit'; id: string; code: number };

export type TerminalListener = (event: TerminalEvent) => void;

export class TerminalError extends Error {
  constructor(readonly code: 'unavailable' | 'too-many' | 'spawn-failed') {
    super(code);
    this.name = 'TerminalError';
  }
}

interface Running {
  info: TerminalInfo;
  pty: PtyProcess;
  ring: ByteRing;
  seq: number;
  endedAt?: number;
  typedAt?: number;
  roleInstructions: string | undefined;
  configDir: string | undefined;
}

export interface TerminalServiceDeps {
  /** The engine, or null when `node-pty` is not installed on this computer. */
  spawner: () => PtySpawner | null;
  now: () => number;
  newId: () => string;
  /** How long programs get to stop by themselves before being forced to. */
  stopGraceMs?: number;
  /** How long a program gets to take a pasted message before Enter is pressed. */
  pasteSettleMs?: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(value)));
}

export class TerminalService {
  private readonly terminals = new Map<string, Running>();
  private readonly listeners = new Set<TerminalListener>();
  private readonly links = new Map<string, Set<string>>();

  constructor(private readonly deps: TerminalServiceDeps) {}

  get available(): boolean {
    return this.deps.spawner() !== null;
  }

  subscribe(listener: TerminalListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  list(): TerminalInfo[] {
    return [...this.terminals.values()].map((terminal) => terminal.info);
  }

  /** The terminal a process runs in: how a session of the office finds its terminal, even after a `/clear`. */
  idFor(pid: number | undefined): string | undefined {
    if (pid === undefined) return undefined;
    for (const terminal of this.terminals.values())
      if (terminal.pty.pid === pid && terminal.endedAt === undefined) return terminal.info.id;
    return undefined;
  }

  start(spec: TerminalSpec): TerminalInfo {
    const spawner = this.deps.spawner();
    if (spawner === null) throw new TerminalError('unavailable');
    this.sweep();
    if ([...this.terminals.values()].filter((terminal) => terminal.endedAt === undefined).length >= MAX_TERMINALS)
      throw new TerminalError('too-many');
    const cols = clamp(spec.cols, MIN_COLS, MAX_COLS);
    const rows = clamp(spec.rows, MIN_ROWS, MAX_ROWS);
    const id = this.deps.newId();
    let pty: PtyProcess;
    try {
      pty = spawner(spec.file, spec.args, 'xterm-256color', {
        cwd: spec.cwd,
        env: { ...spec.env, AI_OFFICE_TERMINAL_ID: id },
        cols,
        rows,
      });
    } catch {
      throw new TerminalError('spawn-failed');
    }
    const info: TerminalInfo = {
      id,
      cwd: spec.cwd,
      cols,
      rows,
      startedAt: this.deps.now(),
      ...(spec.role !== undefined ? { role: spec.role } : {}),
    };
    const terminal: Running = {
      info,
      pty,
      ring: new ByteRing(REPLAY_BYTES),
      seq: 0,
      roleInstructions: spec.roleInstructions,
      configDir: spec.configDir,
    };
    this.terminals.set(info.id, terminal);
    pty.onData((data) => this.onOutput(terminal, data));
    pty.onExit((code) => this.onExit(terminal, code));
    return info;
  }

  write(id: string, data: string): boolean {
    const terminal = this.running(id);
    if (terminal === undefined) return false;
    terminal.typedAt = this.deps.now();
    terminal.pty.write(data);
    return true;
  }

  /** When it last got text: Enter right after would send a half-written message, or two messages as one. */
  typedAt(id: string): number | undefined {
    return this.terminals.get(id)?.typedAt;
  }

  resize(id: string, cols: number, rows: number): boolean {
    const terminal = this.running(id);
    if (terminal === undefined) return false;
    const nextCols = clamp(cols, MIN_COLS, MAX_COLS);
    const nextRows = clamp(rows, MIN_ROWS, MAX_ROWS);
    if (terminal.info.cols !== nextCols || terminal.info.rows !== nextRows) {
      terminal.pty.resize(nextCols, nextRows);
      terminal.info = { ...terminal.info, cols: nextCols, rows: nextRows };
    }
    return true;
  }

  kill(id: string): boolean {
    const terminal = this.running(id);
    if (terminal === undefined) return false;
    terminal.pty.kill();
    return true;
  }

  /** Connects two running terminals: each one's agent can now message the other. */
  connect(a: string, b: string): boolean {
    if (a === b || this.running(a) === undefined || this.running(b) === undefined) return false;
    this.linkOf(a).add(b);
    this.linkOf(b).add(a);
    return true;
  }

  disconnect(a: string, b: string): void {
    this.links.get(a)?.delete(b);
    this.links.get(b)?.delete(a);
  }

  peersOf(id: string): string[] {
    return [...(this.links.get(id) ?? [])];
  }

  /** What is needed to start the terminal again later. */
  startInfo(id: string): { roleInstructions: string | undefined; configDir: string | undefined } | undefined {
    const terminal = this.terminals.get(id);
    return terminal === undefined
      ? undefined
      : { roleInstructions: terminal.roleInstructions, configDir: terminal.configDir };
  }

  /** Pastes a message into a connected terminal and presses Enter. */
  deliver(from: string, to: string, text: string): boolean {
    if (!this.links.get(from)?.has(to)) return false;
    return this.paste(to, text);
  }

  /** Pastes text into a terminal and presses Enter, as if the person had. */
  paste(to: string, text: string): boolean {
    const target = this.running(to);
    if (target === undefined) return false;
    target.typedAt = this.deps.now();
    target.pty.write(`${PASTE_START}${cleanMessage(text)}${PASTE_END}`);
    // A program reads a paste in pieces: an Enter arriving in the same read would count as part of it.
    setTimeout(() => {
      if (target.endedAt === undefined) target.pty.write('\r');
    }, this.deps.pasteSettleMs ?? PASTE_SETTLE_MS);
    return true;
  }

  /** What a page needs to redraw the terminal: the newest output and the number of the last chunk in it. */
  replay(id: string): { seq: number; data: Buffer } | undefined {
    const terminal = this.terminals.get(id);
    return terminal === undefined ? undefined : { seq: terminal.seq, data: terminal.ring.snapshot() };
  }

  /** Forgets terminals that ended a while ago. */
  sweep(): void {
    const now = this.deps.now();
    for (const [id, terminal] of this.terminals)
      if (terminal.endedAt !== undefined && now - terminal.endedAt >= ENDED_LINGER_MS) this.terminals.delete(id);
  }

  /** Hangs up on every program, and forces the ones still running after a moment. */
  async stopAll(): Promise<void> {
    const running = (): Running[] => [...this.terminals.values()].filter((terminal) => terminal.endedAt === undefined);
    const hungUp = running();
    if (hungUp.length === 0) return;
    for (const terminal of hungUp) terminal.pty.kill();
    await new Promise((resolve) => setTimeout(resolve, this.deps.stopGraceMs ?? STOP_GRACE_MS));
    for (const terminal of running()) terminal.pty.kill('SIGKILL');
  }

  private linkOf(id: string): Set<string> {
    let peers = this.links.get(id);
    if (peers === undefined) {
      peers = new Set();
      this.links.set(id, peers);
    }
    return peers;
  }

  private running(id: string): Running | undefined {
    const terminal = this.terminals.get(id);
    return terminal?.endedAt === undefined ? terminal : undefined;
  }

  private onOutput(terminal: Running, data: Buffer): void {
    terminal.ring.append(data);
    terminal.seq += 1;
    this.emit({ kind: 'output', id: terminal.info.id, seq: terminal.seq, data });
  }

  private onExit(terminal: Running, code: number): void {
    terminal.endedAt = this.deps.now();
    terminal.info = { ...terminal.info, exitCode: code };
    for (const peer of this.peersOf(terminal.info.id)) this.disconnect(terminal.info.id, peer);
    this.emit({ kind: 'exit', id: terminal.info.id, code });
  }

  private emit(event: TerminalEvent): void {
    for (const listener of this.listeners) listener(event);
  }
}
