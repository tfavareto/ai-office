// The member side: pairing once (with the code), then one long-lived encrypted connection to the host that sends this
// computer's sanitized share and receives the merged team view. It reconnects with a growing delay, and stops by itself
// only when the host says it must (removed, team ended) or its key no longer matches the one pinned at pairing.
import { type Socket, connect } from 'node:net';
import {
  EMPTY_TEAM_SHARE,
  TEAM_PROTOCOL_VERSION,
  parseTeamView,
  type TeamErrorCode,
  type TeamLink,
  type TeamPerson,
  type TeamShare,
  type TeamViewMsg,
} from '@ai-office/shared';
import type { Logger } from '../log';
import { FrameError, FramedConn } from './conn';
import { fingerprint, fromB64, importIdentity, type Identity } from './keys';
import {
  BACKOFF_FIRST_MS,
  BACKOFF_MAX_MS,
  BACKOFF_SLOW_MS,
  CONNECT_TIMEOUT_MS,
  DEAD_AFTER_MS,
  DOWN_MAX_BYTES,
  PING_EVERY_MS,
  SHARE_KEEPALIVE_MS,
  SHARE_MIN_INTERVAL_MS,
  UP_MAX_BYTES,
} from './limits';
import { type PairInput, type Paired, memberPair } from './pair';
import { peopleFromView } from './people';
import { SEAL_OVERHEAD, type SecureChannel } from './secure-channel';
import { memberSession } from './session';
import type { JoinedFile } from './store';
import { ProtocolError, decode, encode } from './wire';

/** Errors after which trying again is pointless until the person acts. */
const FATAL: ReadonlySet<TeamErrorCode> = new Set(['revoked', 'unknown-member', 'ended']);
/**
 * Errors a stranger on the network could also produce (nothing authentic yet): a forged answer must not be able to
 * switch a member off for good, so it is shown as a warning and the member keeps checking, slowly. `host-key-changed`
 * is in this list too: the member sends nothing but its id and a fresh ephemeral key before the host's signature is
 * checked, so retrying leaks nothing.
 */
const SLOW: ReadonlySet<TeamErrorCode> = new Set([
  'version-mismatch',
  'replaced',
  'rate-limited',
  'protocol-error',
  'host-key-changed',
]);

export function connectTcp(address: string, port: number, timeoutMs = CONNECT_TIMEOUT_MS): Promise<FramedConn> {
  return new Promise((resolve, reject) => {
    const socket: Socket = connect({ host: address, port });
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new ProtocolError('timeout'));
    }, timeoutMs);
    socket.once('connect', () => {
      clearTimeout(timer);
      socket.removeAllListeners('error');
      resolve(new FramedConn(socket, DOWN_MAX_BYTES + SEAL_OVERHEAD));
    });
    socket.once('error', () => {
      clearTimeout(timer);
      reject(new ProtocolError('unreachable'));
    });
  });
}

/** Joins a team: one pairing handshake with the code. Rejects with a ProtocolError. */
export async function pairWithHost(address: string, port: number, input: PairInput): Promise<Paired> {
  const conn = await connectTcp(address, port);
  try {
    return await memberPair(conn, input);
  } catch (error) {
    if (error instanceof ProtocolError) throw error;
    throw new ProtocolError(error instanceof FrameError && error.code === 'timeout' ? 'timeout' : 'unreachable');
  } finally {
    conn.destroy();
  }
}

export interface MemberDeps {
  now: () => number;
  log: Logger;
  /** The page-visible state changed. */
  onChange: () => void;
  /** 0..1, for the jitter of the reconnect delay. */
  random?: () => number;
  /** Delays are multiplied by this (tests). */
  delayScale?: number;
}

export class TeamMember {
  private readonly identity: Identity;
  private readonly hostPub: Buffer;
  private currentLink: TeamLink = 'connecting';
  private currentError: TeamErrorCode | undefined;
  private view: { msg: TeamViewMsg; at: number } | undefined;
  private share: TeamShare = EMPTY_TEAM_SHARE;
  private shareSig = '';
  private dirty = true;
  private stopped = true;
  private conn: FramedConn | undefined;
  private channel: SecureChannel | undefined;
  private wake: (() => void) | undefined;
  private loopDone: Promise<void> = Promise.resolve();

  constructor(
    private readonly file: JoinedFile,
    private readonly deps: MemberDeps,
  ) {
    this.identity = importIdentity(file.identity);
    this.hostPub = fromB64(file.hostPub, 32);
  }

  get link(): TeamLink {
    return this.currentLink;
  }

  get error(): TeamErrorCode | undefined {
    return this.currentError;
  }

  get teamName(): string {
    return this.view?.msg.teamName ?? this.file.teamName;
  }

  /** Fingerprint of the host key pinned at pairing, for people to compare out of band. */
  get hostFingerprint(): string {
    return fingerprint(this.hostPub);
  }

  /** The others in the team (never this computer), with times on this computer's clock. */
  people(): TeamPerson[] {
    if (this.view === undefined || this.currentLink !== 'connected') return [];
    return peopleFromView(
      this.view.msg.members.filter((member) => member.id !== this.file.memberId),
      this.view.at,
    );
  }

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    this.loopDone = this.loop();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    this.conn?.destroy();
    this.wake?.();
    await this.loopDone;
  }

  /** Tells the host this device is leaving (best effort), then stops. */
  async leave(): Promise<void> {
    const { conn, channel } = this;
    if (conn !== undefined && channel !== undefined && this.currentLink === 'connected') {
      conn.send(channel.seal(encode({ t: 'bye', reason: 'leave' })));
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    await this.stop();
  }

  setShare(share: TeamShare): void {
    const signature = JSON.stringify(share, (key, value: unknown) => (key === 'sinceAgeMs' ? undefined : value));
    this.share = share;
    if (signature === this.shareSig) return;
    this.shareSig = signature;
    this.dirty = true;
  }

  // ---- the connection loop -----------------------------------------------------------------------------------------

  private setLink(link: TeamLink, error?: TeamErrorCode): void {
    if (link === this.currentLink && error === this.currentError) return;
    this.currentLink = link;
    this.currentError = error;
    if (link !== 'connected') this.view = undefined;
    this.deps.onChange();
  }

  private async loop(): Promise<void> {
    let attempt = 0;
    while (!this.stopped) {
      // Between failed tries the state stays "offline" (no flicker back to "connecting").
      if (this.currentLink !== 'offline') this.setLink('connecting');
      let code: TeamErrorCode = 'unreachable';
      try {
        await this.session(() => (attempt = 0));
      } catch (error) {
        code = errorCode(error);
      } finally {
        this.conn?.destroy();
        this.conn = undefined;
        this.channel = undefined;
      }
      if (this.stopped) break;
      if (FATAL.has(code)) {
        this.setLink('rejected', code);
        return;
      }
      this.setLink('offline', code);
      await this.sleep(
        SLOW.has(code) ? Math.round(BACKOFF_SLOW_MS * (this.deps.delayScale ?? 1)) : this.backoff(attempt++),
      );
    }
  }

  private backoff(attempt: number): number {
    const base = Math.min(BACKOFF_MAX_MS, BACKOFF_FIRST_MS * 2 ** attempt);
    const jitter = 0.75 + (this.deps.random ?? Math.random)() * 0.5;
    return Math.round(base * jitter * (this.deps.delayScale ?? 1));
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      const timer = setTimeout(done, ms);
      timer.unref();
      this.wake = done;
      function done(): void {
        clearTimeout(timer);
        resolve();
      }
    });
  }

  private async session(connected: () => void): Promise<void> {
    const conn = await connectTcp(this.file.address, this.file.port);
    this.conn = conn;
    if (this.stopped) {
      conn.destroy();
      throw new ProtocolError('unreachable');
    }
    const { channel, ready } = await memberSession(conn, {
      memberId: this.file.memberId,
      identity: this.identity,
      hostPub: this.hostPub,
    });
    const first = decode(channel.open(ready));
    if (first.t !== 'ready' || first.v !== TEAM_PROTOCOL_VERSION) throw new ProtocolError('protocol-error');
    this.channel = channel;
    conn.setMaxBytes(DOWN_MAX_BYTES + SEAL_OVERHEAD);
    connected();
    this.dirty = true;
    this.setLink('connected');
    await this.pump(conn, channel);
  }

  private async pump(conn: FramedConn, channel: SecureChannel): Promise<void> {
    let lastTx = this.deps.now();
    let lastShare = 0;
    const send = (message: Record<string, unknown>): void => {
      const plain = encode(message);
      if (plain.length > UP_MAX_BYTES) return;
      lastTx = this.deps.now();
      conn.send(channel.seal(plain));
    };
    const timer = setInterval(() => {
      const time = this.deps.now();
      if (time - lastTx >= PING_EVERY_MS) send({ t: 'ping' });
      const due = this.dirty && time - lastShare >= SHARE_MIN_INTERVAL_MS;
      if (due || time - lastShare >= SHARE_KEEPALIVE_MS) {
        this.dirty = false;
        lastShare = time;
        send({ t: 'share', share: this.share });
      }
    }, 250);
    timer.unref();
    try {
      for (;;) {
        const message = decode(channel.open(await conn.read(DEAD_AFTER_MS)));
        if (message.t === 'view') {
          const view = parseTeamView(message.view);
          if (view !== undefined) {
            this.view = { msg: view, at: this.deps.now() };
            this.deps.onChange();
          }
        } else if (message.t === 'ping') send({ t: 'pong' });
        else if (message.t === 'bye') throw new ProtocolError(byeCode(message.reason));
        else if (message.t !== 'pong') throw new ProtocolError('protocol-error');
      }
    } finally {
      clearInterval(timer);
    }
  }
}

function byeCode(reason: unknown): TeamErrorCode {
  switch (reason) {
    case 'revoked':
      return 'revoked';
    case 'ended':
      return 'ended';
    case 'replaced':
      return 'replaced';
    case 'rate-limited':
      return 'rate-limited';
    default:
      return 'unreachable';
  }
}

function errorCode(error: unknown): TeamErrorCode {
  if (error instanceof ProtocolError) return error.code;
  if (error instanceof FrameError) return error.code === 'timeout' ? 'timeout' : 'unreachable';
  return 'protocol-error';
}
