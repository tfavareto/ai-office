// The host of a team: a TCP listener (bound to one chosen LAN address, never a wildcard) that speaks only the team
// protocol, the list of members, their latest shares and the merged view it sends back to everybody. It serves no
// HTTP, no web app and no local endpoint: a stranger sending anything else is dropped without a reply.
import { type Server, type Socket, createServer } from 'node:net';
import { randomBytes } from 'node:crypto';
import {
  EMPTY_TEAM_SHARE,
  TEAM_MAX_MEMBERS,
  TEAM_PROTOCOL_VERSION,
  parseTeamShare,
  type HostMember,
  type PairingStatus,
  type TeamErrorCode,
  type TeamPerson,
  type TeamShare,
  type TeamViewMember,
  type TeamViewMsg,
} from '@ai-office/shared';
import type { Logger } from '../log';
import { RateLimiter } from '../util/rate-limit';
import { isTeamAddress } from './addresses';
import { FrameError, FramedConn } from './conn';
import { type Identity, fromB64, importIdentity } from './keys';
import {
  DEAD_AFTER_MS,
  DOWN_MAX_BYTES,
  HANDSHAKE_MAX_BYTES,
  HANDSHAKE_TIMEOUT_MS,
  MAX_PENDING,
  MAX_PENDING_PER_IP,
  MESSAGES_PER_WINDOW,
  MESSAGE_WINDOW_MS,
  PAIR_ATTEMPTS_PER_MINUTE,
  PING_EVERY_MS,
  SESSION_FAILURES_PER_MINUTE,
  SESSION_HELLOS_PER_MINUTE,
  UP_MAX_BYTES,
  VIEW_MIN_INTERVAL_MS,
} from './limits';
import { PairingGate } from './pairing';
import { hostPair } from './pair';
import { peopleFromView } from './people';
import { SEAL_OVERHEAD, type SecureChannel } from './secure-channel';
import { hostSession } from './session';
import type { HostFile, StoredMember } from './store';
import { ProtocolError, decode, encode, sendPlain, type WireMessage } from './wire';

const MINUTE_MS = 60_000;
const LIMITER_IDLE_MS = 10 * MINUTE_MS;

export interface HostDeps {
  now: () => number;
  log: Logger;
  /** Writes the host file; resolves false when the disk refused. */
  save: (file: HostFile) => Promise<boolean>;
  /** The page-visible state changed. */
  onChange: () => void;
  /** Replaces the scrypt stretching (tests only). */
  stretch?: (code: string, salt: Buffer) => Promise<Buffer>;
}

interface Session {
  memberId: string;
  conn: FramedConn;
  channel: SecureChannel;
  limiter: RateLimiter;
  lastRx: number;
  lastTx: number;
  lastViewAt: number;
  dirty: boolean;
}

interface Received {
  share: TeamShare;
  at: number;
}

/** A sliding-window limiter per source address, forgotten when idle. */
class PerAddress {
  private readonly map = new Map<string, { limiter: RateLimiter; lastAt: number }>();

  constructor(
    private readonly limit: number,
    private readonly now: () => number,
  ) {}

  allow(address: string): boolean {
    const time = this.now();
    let entry = this.map.get(address);
    if (entry === undefined) {
      entry = { limiter: new RateLimiter(this.limit, MINUTE_MS, this.now), lastAt: time };
      this.map.set(address, entry);
    }
    entry.lastAt = time;
    return entry.limiter.tryAcquire();
  }

  sweep(): void {
    const time = this.now();
    for (const [address, entry] of this.map) if (time - entry.lastAt > LIMITER_IDLE_MS) this.map.delete(address);
  }
}

export class TeamHost {
  readonly gate: PairingGate;
  private file: HostFile;
  private identity: Identity;
  private server: Server | undefined;
  private bound: { address: string; port: number } | undefined;
  private lastError: TeamErrorCode | undefined;
  private readonly sockets = new Set<Socket>();
  private readonly saving = new Set<Promise<unknown>>();
  private readonly sessions = new Map<string, Session>();
  private readonly received = new Map<string, Received>();
  private readonly lastSeen = new Map<string, number>();
  private localShare: TeamShare = EMPTY_TEAM_SHARE;
  private localShareSig = '';
  private pending = 0;
  private readonly pendingByAddress = new Map<string, number>();
  private readonly pairLimits: PerAddress;
  private readonly helloLimits: PerAddress;
  private readonly failureLimits: PerAddress;
  private timer: NodeJS.Timeout | undefined;
  private lastTick = 0;

  constructor(
    file: HostFile,
    private readonly deps: HostDeps,
  ) {
    this.file = file;
    this.identity = importIdentity(file.identity);
    this.gate = new PairingGate(deps.now, undefined, undefined, deps.stretch);
    this.pairLimits = new PerAddress(PAIR_ATTEMPTS_PER_MINUTE, deps.now);
    this.helloLimits = new PerAddress(SESSION_HELLOS_PER_MINUTE, deps.now);
    this.failureLimits = new PerAddress(SESSION_FAILURES_PER_MINUTE, deps.now);
  }

  // ---- state for the page ------------------------------------------------------------------------------------------

  get teamName(): string {
    return this.file.teamName;
  }

  get hostName(): string {
    return this.file.hostName;
  }

  get listening(): boolean {
    return this.server?.listening === true;
  }

  get address(): { address: string; port: number } | undefined {
    return this.bound;
  }

  get error(): TeamErrorCode | undefined {
    return this.lastError;
  }

  pairing(): PairingStatus | undefined {
    return this.gate.status();
  }

  members(): HostMember[] {
    return this.file.members.map((member) => {
      const online = this.sessions.has(member.id);
      const seen = this.lastSeen.get(member.id) ?? member.lastSeenAt;
      return {
        id: member.id,
        name: member.name,
        device: member.device,
        online,
        createdAt: member.createdAt,
        ...(!online && seen !== undefined ? { lastSeenAt: seen } : {}),
      };
    });
  }

  /** The people the host's own page draws: every member but the host. */
  people(): TeamPerson[] {
    const time = this.deps.now();
    return peopleFromView(
      this.viewMembers(time).filter((member) => !member.host),
      time,
    );
  }

  // ---- lifecycle ---------------------------------------------------------------------------------------------------

  /** Opens the listener on one address. Resolves with an error code, or undefined when it listens. */
  async listen(address: string, port: number): Promise<TeamErrorCode | undefined> {
    if (this.server !== undefined) await this.stop();
    const server = createServer((socket) => this.onSocket(socket));
    this.server = server;
    const failure = await new Promise<TeamErrorCode | undefined>((resolve) => {
      server.once('error', (error: NodeJS.ErrnoException) => {
        resolve(error.code === 'EADDRNOTAVAIL' ? 'address-not-available' : 'listen-failed');
      });
      server.listen({ host: address, port, exclusive: true }, () => resolve(undefined));
    });
    if (failure !== undefined) {
      this.server = undefined;
      this.lastError = failure;
      this.deps.onChange();
      return failure;
    }
    server.on('error', (error) => this.deps.log.warn(`Modo time: erro no listener: ${String(error)}`));
    const bound = server.address();
    this.bound = { address, port: typeof bound === 'object' && bound !== null ? bound.port : port };
    this.lastError = undefined;
    this.timer = setInterval(() => this.tick(), 1000);
    this.timer.unref();
    this.deps.onChange();
    return undefined;
  }

  /** Closes the listener and every connection; the team and its members are kept. */
  async stop(): Promise<void> {
    if (this.timer !== undefined) clearInterval(this.timer);
    this.timer = undefined;
    this.gate.close();
    for (const session of [...this.sessions.values()]) this.endSession(session, 'stopped');
    const server = this.server;
    this.server = undefined;
    this.bound = undefined;
    // Closing the listener waits for open connections: end the unfinished handshakes now.
    setTimeout(() => this.sockets.forEach((socket) => socket.destroy()), 300).unref();
    if (server !== undefined) await new Promise<void>((resolve) => server.close(() => resolve()));
    await Promise.allSettled([...this.saving]);
    this.deps.onChange();
  }

  /** The team is over: members are told, then everything stops. The caller deletes the files. */
  async end(): Promise<void> {
    for (const session of [...this.sessions.values()]) this.endSession(session, 'ended');
    await this.stop();
  }

  async newCode(): Promise<PairingStatus> {
    const status = await this.gate.open();
    this.deps.onChange();
    return status;
  }

  /** Removes a member: its key is forgotten, it is told if connected, and later hellos are answered "removed". */
  async revoke(memberId: string): Promise<boolean> {
    if (!this.file.members.some((member) => member.id === memberId)) return false;
    const next: HostFile = {
      ...this.file,
      members: this.file.members.filter((member) => member.id !== memberId),
      revoked: [...this.file.revoked, memberId].slice(-64),
    };
    if (!(await this.deps.save(next))) return false;
    this.file = next;
    const session = this.sessions.get(memberId);
    if (session !== undefined) this.endSession(session, 'revoked');
    this.received.delete(memberId);
    this.markAllDirty();
    this.deps.onChange();
    return true;
  }

  /** The host's own office, shared like any member's. */
  setLocalShare(share: TeamShare): void {
    const signature = JSON.stringify(share, (key, value: unknown) => (key === 'sinceAgeMs' ? undefined : value));
    if (signature === this.localShareSig) {
      this.localShare = share;
      return;
    }
    this.localShareSig = signature;
    this.localShare = share;
    this.markAllDirty();
    this.deps.onChange();
  }

  setNames(names: { teamName?: string; hostName?: string }): Promise<boolean> {
    const next: HostFile = {
      ...this.file,
      ...(names.teamName !== undefined ? { teamName: names.teamName } : {}),
      ...(names.hostName !== undefined ? { hostName: names.hostName } : {}),
    };
    return this.persist(next);
  }

  /** Remembers where the listener is (or that it is off) so the app can bring it back. */
  setListen(listen: HostFile['listen']): Promise<boolean> {
    const next: HostFile = { ...this.file };
    if (listen === undefined) delete next.listen;
    else next.listen = listen;
    return this.persist(next);
  }

  private async persist(next: HostFile): Promise<boolean> {
    const saving = this.deps.save(next);
    this.saving.add(saving);
    try {
      if (!(await saving)) return false;
    } finally {
      this.saving.delete(saving);
    }
    this.file = next;
    return true;
  }

  // ---- connections -------------------------------------------------------------------------------------------------

  private onSocket(socket: Socket): void {
    const raw = socket.remoteAddress ?? '';
    const address = raw.startsWith('::ffff:') ? raw.slice(7) : raw;
    const perAddress = this.pendingByAddress.get(address) ?? 0;
    if (!isTeamAddress(address) || this.pending >= MAX_PENDING || perAddress >= MAX_PENDING_PER_IP) {
      socket.destroy();
      return;
    }
    this.pending++;
    this.pendingByAddress.set(address, perAddress + 1);
    this.sockets.add(socket);
    socket.once('close', () => this.sockets.delete(socket));
    const release = (): void => {
      this.pending = Math.max(0, this.pending - 1);
      const left = (this.pendingByAddress.get(address) ?? 1) - 1;
      if (left <= 0) this.pendingByAddress.delete(address);
      else this.pendingByAddress.set(address, left);
    };
    const conn = new FramedConn(socket, HANDSHAKE_MAX_BYTES);
    const deadline = setTimeout(() => conn.destroy(), HANDSHAKE_TIMEOUT_MS);
    let released = false;
    const done = (): void => {
      clearTimeout(deadline);
      if (!released) release();
      released = true;
    };
    conn.onClose(done);
    this.handshake(conn, address, done).catch((error: unknown) => {
      if (!(error instanceof FrameError)) this.deps.log.debug(`Modo time: ${String(error)}`);
      conn.destroy();
      done();
    });
  }

  private async handshake(conn: FramedConn, address: string, authenticated: () => void): Promise<void> {
    const first = decode(await conn.read(HANDSHAKE_TIMEOUT_MS));
    const refuse = (code: TeamErrorCode): void => {
      sendPlain(conn, { t: 'error', code });
      conn.close();
    };
    if (first.t === 'pair-hello') {
      if (!this.pairLimits.allow(address)) return refuse('rate-limited');
      await hostPair(conn, first, {
        gate: this.gate,
        identity: this.identity,
        teamId: this.file.teamId,
        teamName: this.file.teamName,
        hostName: this.file.hostName,
        addMember: (member) => this.addMember(member),
        onWrongProof: () => this.failureLimits.allow(address),
      });
      this.deps.onChange();
      return;
    }
    if (first.t !== 'hello') return conn.destroy();
    if (!this.helloLimits.allow(address)) return refuse('rate-limited');
    let session;
    try {
      session = await hostSession(conn, first, { identity: this.identity, lookup: (id) => this.lookup(id) });
    } catch (error) {
      return refuse(error instanceof ProtocolError ? error.code : 'protocol-error');
    }
    if (session === undefined) {
      this.failureLimits.allow(address);
      return;
    }
    authenticated();
    await this.runSession(conn, session.memberId, session.channel);
  }

  private lookup(memberId: string): { pub: Buffer } | 'revoked' | 'unknown' {
    const member = this.file.members.find((candidate) => candidate.id === memberId);
    if (member !== undefined) return { pub: fromB64(member.pub, 32) };
    return this.file.revoked.includes(memberId) ? 'revoked' : 'unknown';
  }

  private async addMember(input: { name: string; device: string; pub: Buffer }): Promise<string | undefined> {
    if (this.file.members.length >= TEAM_MAX_MEMBERS) return undefined;
    const member: StoredMember = {
      id: randomBytes(12).toString('base64url'),
      name: input.name,
      device: input.device,
      pub: input.pub.toString('base64'),
      createdAt: this.deps.now(),
    };
    return (await this.persist({ ...this.file, members: [...this.file.members, member] })) ? member.id : undefined;
  }

  // ---- an authenticated member ---------------------------------------------------------------------------------------

  private async runSession(conn: FramedConn, memberId: string, channel: SecureChannel): Promise<void> {
    const old = this.sessions.get(memberId);
    if (old !== undefined) this.endSession(old, 'replaced');
    conn.setMaxBytes(UP_MAX_BYTES + SEAL_OVERHEAD);
    const time = this.deps.now();
    const session: Session = {
      memberId,
      conn,
      channel,
      limiter: new RateLimiter(MESSAGES_PER_WINDOW, MESSAGE_WINDOW_MS, this.deps.now),
      lastRx: time,
      lastTx: time,
      lastViewAt: 0,
      dirty: true,
    };
    this.sessions.set(memberId, session);
    this.send(session, {
      t: 'ready',
      v: TEAM_PROTOCOL_VERSION,
      teamName: this.file.teamName,
      hostName: this.file.hostName,
    });
    this.markAllDirty();
    this.deps.onChange();
    try {
      for (;;) {
        const frame = await conn.read(DEAD_AFTER_MS);
        session.lastRx = this.deps.now();
        this.lastSeen.set(memberId, session.lastRx);
        if (!session.limiter.tryAcquire()) {
          this.send(session, { t: 'bye', reason: 'rate-limited' });
          break;
        }
        if (!(await this.onMessage(session, decode(session.channel.open(frame))))) break;
      }
    } catch (error) {
      if (!(error instanceof FrameError) || error.code === 'too-large' || error.code === 'flood')
        this.deps.log.debug(`Modo time: conexão de membro encerrada: ${String(error)}`);
    } finally {
      if (this.sessions.get(memberId) === session) {
        this.sessions.delete(memberId);
        this.lastSeen.set(memberId, this.deps.now());
        this.markAllDirty();
        this.deps.onChange();
        void this.rememberSeen(memberId);
      }
      conn.destroy();
    }
  }

  /** Returns false to end the session. */
  private async onMessage(session: Session, message: WireMessage): Promise<boolean> {
    switch (message.t) {
      case 'share': {
        const share = parseTeamShare(message.share);
        if (share === undefined) {
          this.send(session, { t: 'bye', reason: 'protocol-error' });
          return false;
        }
        this.received.set(session.memberId, { share, at: this.deps.now() });
        this.markAllDirty();
        this.deps.onChange();
        return true;
      }
      case 'ping':
        this.send(session, { t: 'pong' });
        return true;
      case 'pong':
        return true;
      case 'bye':
        if (message.reason === 'leave') await this.forget(session.memberId);
        return false;
      default:
        this.send(session, { t: 'bye', reason: 'protocol-error' });
        return false;
    }
  }

  /** A member left by itself: its key is dropped (a new pairing is needed to come back). */
  private async forget(memberId: string): Promise<void> {
    await this.persist({ ...this.file, members: this.file.members.filter((member) => member.id !== memberId) });
    this.received.delete(memberId);
    this.markAllDirty();
  }

  private async rememberSeen(memberId: string): Promise<void> {
    const seen = this.lastSeen.get(memberId);
    if (seen === undefined || !this.file.members.some((member) => member.id === memberId)) return;
    await this.persist({
      ...this.file,
      members: this.file.members.map((member) => (member.id === memberId ? { ...member, lastSeenAt: seen } : member)),
    });
  }

  private endSession(session: Session, reason: string): void {
    if (this.sessions.get(session.memberId) === session) this.sessions.delete(session.memberId);
    this.send(session, { t: 'bye', reason });
    session.conn.close();
  }

  private send(session: Session, message: Record<string, unknown>): void {
    const plain = encode(message);
    if (plain.length > DOWN_MAX_BYTES) return;
    session.lastTx = this.deps.now();
    session.conn.send(session.channel.seal(plain));
  }

  // ---- the merged view -------------------------------------------------------------------------------------------------

  private markAllDirty(): void {
    for (const session of this.sessions.values()) session.dirty = true;
  }

  /** Everybody in the team, the host first; ages are counted to `time`. A member's share is shown only while it is online. */
  private viewMembers(time: number): TeamViewMember[] {
    const own: TeamViewMember = {
      id: this.file.teamId,
      name: this.file.hostName,
      device: this.file.hostDevice,
      host: true,
      online: this.listening,
      share: this.localShare,
    };
    const others = this.file.members.map((member): TeamViewMember => {
      const online = this.sessions.has(member.id);
      const received = this.received.get(member.id);
      const seen = this.lastSeen.get(member.id) ?? member.lastSeenAt;
      return {
        id: member.id,
        name: member.name,
        device: member.device,
        host: false,
        online,
        ...(!online && seen !== undefined ? { lastSeenAgoMs: Math.max(0, time - seen) } : {}),
        ...(online && received !== undefined ? { share: aged(received.share, time - received.at) } : {}),
      };
    });
    return [own, ...others];
  }

  /** The view a member gets: the same team without its own share (it already has its own office). */
  private viewFor(memberId: string, time: number): TeamViewMsg {
    return {
      teamName: this.file.teamName,
      members: this.viewMembers(time).map((member) =>
        member.id === memberId ? { ...member, share: undefined } : member,
      ),
    };
  }

  private tick(): void {
    const time = this.deps.now();
    for (const session of [...this.sessions.values()]) {
      if (time - session.lastRx > DEAD_AFTER_MS) {
        this.endSession(session, 'timeout');
        continue;
      }
      if (time - session.lastTx >= PING_EVERY_MS) this.send(session, { t: 'ping' });
      const due = session.dirty && time - session.lastViewAt >= VIEW_MIN_INTERVAL_MS;
      const refresh = time - session.lastViewAt >= 20_000;
      if (!due && !refresh) continue;
      session.dirty = false;
      session.lastViewAt = time;
      this.send(session, { t: 'view', view: stripUndefined(this.viewFor(session.memberId, time)) });
    }
    if (time - this.lastTick > MINUTE_MS) {
      this.lastTick = time;
      this.pairLimits.sweep();
      this.helloLimits.sweep();
      this.failureLimits.sweep();
    }
  }
}

function aged(share: TeamShare, extraMs: number): TeamShare {
  return { ...share, agents: share.agents.map((agent) => ({ ...agent, sinceAgeMs: agent.sinceAgeMs + extraMs })) };
}

/** JSON.stringify drops undefined by itself; this makes the intent explicit for the wire. */
function stripUndefined<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
