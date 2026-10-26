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
import { type Identity, fingerprint, fromB64, importIdentity } from './keys';
import {
  DEAD_AFTER_MS,
  DOWN_MAX_BYTES,
  FIRST_FRAME_MS,
  HANDSHAKE_MAX_BYTES,
  HANDSHAKE_STALL_MS,
  HANDSHAKE_TIMEOUT_MS,
  MESSAGES_PER_WINDOW,
  MESSAGE_WINDOW_MS,
  PAIR_ATTEMPTS_PER_MINUTE,
  PING_EVERY_MS,
  SESSION_FAILURES_PER_MINUTE,
  SESSION_HELLOS_PER_MINUTE,
  UP_MAX_BYTES,
  VIEW_MIN_INTERVAL_MS,
  WRONG_PROOFS_PER_MINUTE,
} from './limits';
import { PairingGate } from './pairing';
import { DEFAULT_PENDING_LIMITS, PendingGate, type PendingLimits } from './pending';
import { hostPair } from './pair';
import { peopleFromView } from './people';
import { SEAL_OVERHEAD, type SecureChannel } from './secure-channel';
import { hostSession } from './session';
import type { HostFile, StoredMember } from './store';
import { ProtocolError, decode, encode, sendPlain, type WireMessage } from './wire';

const MINUTE_MS = 60_000;

export interface HostDeps {
  now: () => number;
  log: Logger;
  /** Writes the host file; resolves false when the disk refused. */
  save: (file: HostFile) => Promise<boolean>;
  /** The page-visible state changed. */
  onChange: () => void;
  /** Replaces the scrypt stretching (tests only). */
  stretch?: (code: string, salt: Buffer) => Promise<Buffer>;
  /** Limits of the connections that have not authenticated yet, and the first-frame deadline (tests). */
  pending?: PendingLimits;
  firstFrameMs?: number;
  /** Which address a connection counts as coming from (tests give each connection its own). */
  addressOf?: (socket: Socket) => string;
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
  /** The share without its ages: a keepalive that says the same thing does not make everybody redraw. */
  signature: string;
}

/** Events per source address in a sliding minute; `isFull` asks without counting. */
class PerAddress {
  private readonly map = new Map<string, number[]>();

  constructor(
    private readonly limit: number,
    private readonly now: () => number,
  ) {}

  private stamps(address: string): number[] {
    const time = this.now();
    const fresh = (this.map.get(address) ?? []).filter((at) => time - at < MINUTE_MS);
    if (fresh.length === 0) this.map.delete(address);
    else this.map.set(address, fresh);
    return fresh;
  }

  isFull(address: string): boolean {
    return this.stamps(address).length >= this.limit;
  }

  record(address: string): void {
    this.map.set(address, [...this.stamps(address), this.now()]);
  }

  /** Counts the event and says whether it is within the limit. */
  allow(address: string): boolean {
    if (this.isFull(address)) return false;
    this.record(address);
    return true;
  }

  sweep(): void {
    for (const address of [...this.map.keys()]) this.stamps(address);
  }
}

const shareSignature = (share: TeamShare): string =>
  JSON.stringify(share, (key, value: unknown) => (key === 'sinceAgeMs' ? undefined : value));

export class TeamHost {
  readonly gate: PairingGate;
  private file: HostFile;
  private identity: Identity;
  private server: Server | undefined;
  private bound: { address: string; port: number } | undefined;
  private lastError: TeamErrorCode | undefined;
  private readonly sockets = new Set<Socket>();
  private readonly sessions = new Map<string, Session>();
  /** Connections that are in the middle of a session handshake, by the member id they claim. */
  private readonly handshaking = new Map<string, Set<FramedConn>>();
  private readonly received = new Map<string, Received>();
  private readonly lastSeen = new Map<string, number>();
  private readonly lastAddress = new Map<string, string>();
  private localShare: TeamShare = EMPTY_TEAM_SHARE;
  private localShareSig = '';
  /** Every change of the host file goes through this chain, each computed from the latest state. */
  private queue: Promise<unknown> = Promise.resolve();
  private ended = false;
  private readonly pendingGate: PendingGate;
  private readonly firstFrameMs: number;
  private readonly pairLimits: PerAddress;
  private readonly wrongProofs: PerAddress;
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
    this.gate = new PairingGate(deps.now, deps.stretch === undefined ? {} : { stretch: deps.stretch });
    this.pendingGate = new PendingGate(deps.now, deps.pending ?? DEFAULT_PENDING_LIMITS);
    // Members that connected before keep their reserve of slots across a restart.
    for (const member of file.members)
      if (member.lastAddress !== undefined) this.pendingGate.markTrusted(member.lastAddress);
    this.firstFrameMs = deps.firstFrameMs ?? FIRST_FRAME_MS;
    this.pairLimits = new PerAddress(PAIR_ATTEMPTS_PER_MINUTE, deps.now);
    this.wrongProofs = new PerAddress(WRONG_PROOFS_PER_MINUTE, deps.now);
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

  /** The host's key fingerprint, for people to compare out of band. */
  get fingerprint(): string {
    return fingerprint(this.identity.publicRaw);
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

  // ---- the host file: one writer ---------------------------------------------------------------------------------------

  /**
   * Changes the host file. `change` receives the latest state (never a stale copy) and returns the next one, or
   * undefined to change nothing. Changes run one after the other, so concurrent ones (a removal, a new member, a
   * last-seen update, a member leaving) cannot overwrite each other. Resolves true when the change was stored.
   */
  private mutate(change: (file: HostFile) => HostFile | undefined): Promise<boolean> {
    const run = this.queue.then(async () => {
      if (this.ended) return false;
      const next = change(this.file);
      if (next === undefined) return false;
      if (!(await this.deps.save(next))) return false;
      this.file = next;
      return true;
    });
    this.queue = run.catch(() => false);
    return run.catch(() => false);
  }

  /** Waits for every change asked so far to be stored. */
  drain(): Promise<unknown> {
    return this.queue;
  }

  private isMember(memberId: string, pub?: Buffer): boolean {
    const member = this.file.members.find((candidate) => candidate.id === memberId);
    return member !== undefined && (pub === undefined || fromB64(member.pub, 32).equals(pub));
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
    await this.drain();
    this.deps.onChange();
  }

  /**
   * The team is over: members are told, then everything stops, and nothing may write the host file again (so it
   * cannot come back after the caller deletes it). The caller deletes the files.
   */
  async end(): Promise<void> {
    this.ended = true;
    for (const session of [...this.sessions.values()]) this.endSession(session, 'ended');
    await this.stop();
  }

  async newCode(): Promise<PairingStatus> {
    const status = await this.gate.open();
    this.deps.onChange();
    return status;
  }

  /**
   * Removes a member: its key is forgotten, it is told if connected, a handshake it has in progress is cut, and later
   * hellos are answered "removed". Resolves false when there is no such member or the disk refused.
   */
  async revoke(memberId: string): Promise<boolean> {
    const stored = await this.mutate((file) =>
      file.members.some((member) => member.id === memberId)
        ? {
            ...file,
            members: file.members.filter((member) => member.id !== memberId),
            revoked: [...file.revoked, memberId].slice(-64),
          }
        : undefined,
    );
    if (!stored) return false;
    this.cutOff(memberId, 'revoked');
    return true;
  }

  /** Closes a member's session and every handshake it has in progress. */
  private cutOff(memberId: string, reason: string): void {
    const session = this.sessions.get(memberId);
    if (session !== undefined) this.endSession(session, reason);
    for (const conn of [...(this.handshaking.get(memberId) ?? [])]) conn.destroy();
    this.received.delete(memberId);
    this.markAllDirty();
    this.deps.onChange();
  }

  /** The host's own office, shared like any member's. */
  setLocalShare(share: TeamShare): void {
    const signature = shareSignature(share);
    this.localShare = share;
    if (signature === this.localShareSig) return;
    this.localShareSig = signature;
    this.markAllDirty();
    this.deps.onChange();
  }

  setNames(names: { teamName?: string; hostName?: string; hostDevice?: string }): Promise<boolean> {
    return this.mutate((file) => ({
      ...file,
      ...(names.teamName !== undefined ? { teamName: names.teamName } : {}),
      ...(names.hostName !== undefined ? { hostName: names.hostName } : {}),
      ...(names.hostDevice !== undefined ? { hostDevice: names.hostDevice } : {}),
    }));
  }

  /** Remembers where the listener is (or that it is off) so the app can bring it back. */
  setListen(listen: HostFile['listen']): Promise<boolean> {
    return this.mutate((file) => {
      const next: HostFile = { ...file };
      if (listen === undefined) delete next.listen;
      else next.listen = listen;
      return next;
    });
  }

  // ---- connections -------------------------------------------------------------------------------------------------

  private onSocket(socket: Socket): void {
    const raw = this.deps.addressOf?.(socket) ?? socket.remoteAddress ?? '';
    const address = raw.startsWith('::ffff:') ? raw.slice(7) : raw;
    const conn = new FramedConn(socket, HANDSHAKE_MAX_BYTES);
    const release = isTeamAddress(address) ? this.pendingGate.admit(address, () => conn.destroy()) : undefined;
    if (release === undefined) {
      socket.destroy();
      return;
    }
    this.sockets.add(socket);
    socket.once('close', () => this.sockets.delete(socket));
    let deadline = setTimeout(() => conn.destroy(), HANDSHAKE_TIMEOUT_MS);
    // Once the first frame is in, a handshake that stalls is cut sooner than the overall deadline.
    const firstFrame = (): void => {
      clearTimeout(deadline);
      deadline = setTimeout(() => conn.destroy(), HANDSHAKE_STALL_MS);
    };
    let released = false;
    const done = (): void => {
      clearTimeout(deadline);
      if (!released) release();
      released = true;
    };
    conn.onClose(done);
    this.handshake(conn, address, done, firstFrame).catch((error: unknown) => {
      if (!(error instanceof FrameError)) this.deps.log.debug(`Modo time: ${String(error)}`);
      conn.destroy();
      done();
    });
  }

  private async handshake(
    conn: FramedConn,
    address: string,
    authenticated: () => void,
    firstFrame: () => void,
  ): Promise<void> {
    // The first frame must come quickly: an idle connection is not allowed to hold a slot for the whole handshake.
    const first = decode(await conn.read(this.firstFrameMs));
    firstFrame();
    const refuse = (code: TeamErrorCode): void => {
      sendPlain(conn, { t: 'error', code });
      conn.close();
    };
    if (first.t === 'pair-hello') {
      // Nothing answers a stranger while no code is open: not even that pairing exists.
      if (!this.gate.isOpen()) return conn.destroy();
      if (!this.pairLimits.allow(address) || this.wrongProofs.isFull(address)) return refuse('rate-limited');
      await hostPair(conn, first, {
        gate: this.gate,
        address,
        identity: this.identity,
        teamId: this.file.teamId,
        teamName: this.file.teamName,
        hostName: this.file.hostName,
        addMember: (member) => this.addMember(member),
        onWrongProof: () => this.wrongProofs.record(address),
      });
      this.deps.onChange();
      return;
    }
    if (first.t !== 'hello') return conn.destroy();
    if (!this.helloLimits.allow(address) || this.failureLimits.isFull(address)) return refuse('rate-limited');
    const claimed = typeof first.member === 'string' ? first.member : undefined;
    const untrack = claimed === undefined ? () => undefined : this.trackHandshake(claimed, conn);
    let session;
    try {
      session = await hostSession(conn, first, { identity: this.identity, lookup: (id) => this.lookup(id) });
    } catch (error) {
      untrack();
      return refuse(error instanceof ProtocolError ? error.code : 'protocol-error');
    }
    untrack();
    if (session === 'bad-signature') {
      this.failureLimits.record(address);
      return;
    }
    if (session === 'refused') return;
    authenticated();
    this.pendingGate.markTrusted(address);
    await this.runSession(conn, address, session.memberId, session.memberPub, session.channel);
  }

  private trackHandshake(memberId: string, conn: FramedConn): () => void {
    const set = this.handshaking.get(memberId) ?? new Set<FramedConn>();
    set.add(conn);
    this.handshaking.set(memberId, set);
    return () => {
      set.delete(conn);
      if (set.size === 0 && this.handshaking.get(memberId) === set) this.handshaking.delete(memberId);
    };
  }

  private lookup(memberId: string): { pub: Buffer } | 'revoked' | 'unknown' {
    const member = this.file.members.find((candidate) => candidate.id === memberId);
    if (member !== undefined) return { pub: fromB64(member.pub, 32) };
    return this.file.revoked.includes(memberId) ? 'revoked' : 'unknown';
  }

  private async addMember(input: {
    name: string;
    device: string;
    pub: Buffer;
  }): Promise<string | { error: 'team-full' | 'save-failed' }> {
    const member: StoredMember = {
      id: randomBytes(12).toString('base64url'),
      name: input.name,
      device: input.device,
      pub: input.pub.toString('base64'),
      createdAt: this.deps.now(),
    };
    let full = false;
    const stored = await this.mutate((file) => {
      full = file.members.length >= TEAM_MAX_MEMBERS;
      return full ? undefined : { ...file, members: [...file.members, member] };
    });
    if (stored) return member.id;
    return { error: full ? 'team-full' : 'save-failed' };
  }

  // ---- an authenticated member ---------------------------------------------------------------------------------------

  private async runSession(
    conn: FramedConn,
    address: string,
    memberId: string,
    memberPub: Buffer,
    channel: SecureChannel,
  ): Promise<void> {
    // The member may have been removed (or replaced) while its handshake was in progress: it must still be this member.
    if (!this.listening || !this.isMember(memberId, memberPub)) {
      conn.destroy();
      return;
    }
    this.lastAddress.set(memberId, address);
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
        if (!this.isMember(memberId, memberPub)) break;
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
        const signature = shareSignature(share);
        const changed = this.received.get(session.memberId)?.signature !== signature;
        this.received.set(session.memberId, { share, at: this.deps.now(), signature });
        if (changed) {
          this.markAllDirty();
          this.deps.onChange();
        }
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
    await this.mutate((file) =>
      file.members.some((member) => member.id === memberId)
        ? { ...file, members: file.members.filter((member) => member.id !== memberId) }
        : undefined,
    );
    this.received.delete(memberId);
    this.markAllDirty();
  }

  private async rememberSeen(memberId: string): Promise<void> {
    const seen = this.lastSeen.get(memberId);
    // Nothing writes the file in the background once the listener is closed.
    if (seen === undefined || !this.listening) return;
    await this.mutate((file) =>
      file.members.some((member) => member.id === memberId)
        ? {
            ...file,
            members: file.members.map((member) =>
              member.id === memberId ? { ...member, lastSeenAt: seen, ...this.addressField(memberId) } : member,
            ),
          }
        : undefined,
    );
  }

  private addressField(memberId: string): { lastAddress?: string } {
    const address = this.lastAddress.get(memberId);
    return address === undefined ? {} : { lastAddress: address };
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
      for (const counter of [this.pairLimits, this.wrongProofs, this.helloLimits, this.failureLimits]) counter.sweep();
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
