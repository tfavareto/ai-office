// Team mode as the rest of the server sees it: one object that owns the host or the member side, the stored state and
// the sharing preferences, and that the REST handlers and the snapshot publisher talk to. Off until the person turns it
// on: nothing listens and nothing connects until "host a team" or "join a team".
import { createHmac, randomBytes } from 'node:crypto';
import {
  TEAM_DEFAULT_PORT,
  TEAM_DEVICE_MAX,
  TEAM_NAME_MAX,
  TEAM_TEAMNAME_MAX,
  buildTeamShare,
  cleanLine,
  isValidPairingCode,
  normalizePairingCode,
  parseSharePrefs,
  type PairingStatus,
  type ShareSource,
  type TeamErrorCode,
  type TeamHostStartRequest,
  type TeamJoinRequest,
  type TeamSharePrefs,
  type TeamSnapshot,
  type TeamStatus,
} from '@ai-office/shared';
import type { Logger } from '../log';
import {
  isLoopbackAddress,
  isOwnAddress,
  isSharedAddress,
  isTeamAddress,
  isValidPort,
  lanInterfaces,
  parseHostPort,
} from './addresses';
import { TeamHost, type HostDeps } from './host';
import { exportIdentity, newIdentity, toB64 } from './keys';
import { TeamMember, pairWithHost } from './member';
import { ProtocolError } from './wire';
import { type HostFile, type JoinedFile, TeamStore } from './store';

/** A refused action: `code` is what the page explains. */
export class TeamActionError extends Error {
  constructor(readonly code: TeamErrorCode) {
    super(code);
  }
}

export interface TeamServiceDeps {
  stateDir: string;
  log: Logger;
  now: () => number;
  /** AI_OFFICE_TEAM=0: the mode cannot be turned on. */
  disabled: boolean;
  /** AI_OFFICE_TEAM_LOOPBACK=1: 127.0.0.1 may host and be joined (two instances on one computer: tests, demos). */
  loopback: boolean;
  /** The name shown for this computer; the host name (without `.local`) when absent. */
  device?: string | undefined;
  /** The office as the page sees it: the share is built from this and nothing else. */
  source: () => ShareSource;
  /** The page-visible team state changed. */
  onChange: () => void;
  stretch?: (code: string, salt: Buffer) => Promise<Buffer>;
  delayScale?: number;
  /** Limits of the host's unauthenticated connections (tests). */
  hostOptions?: Pick<HostDeps, 'pending' | 'firstFrameMs'>;
}

export class TeamService {
  private readonly store: TeamStore;
  private host: TeamHost | undefined;
  private member: TeamMember | undefined;
  /** Management actions run one after the other: a double click or two tabs cannot interleave them. */
  private lock: Promise<unknown> = Promise.resolve();

  constructor(private readonly deps: TeamServiceDeps) {
    this.store = new TeamStore(deps.stateDir, deps.log);
  }

  private exclusive<T>(action: () => Promise<T>): Promise<T> {
    const run = this.lock.then(action, action);
    this.lock = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  // ---- lifecycle ---------------------------------------------------------------------------------------------------

  /** Reads the stored state and brings back what the person left on (the listener, the connection). */
  async start(): Promise<void> {
    if (this.deps.disabled) return;
    await this.store.load();
    if (this.store.host !== undefined) {
      const host = this.createHost(this.store.host);
      const listen = this.store.host.listen;
      const allowed = this.deps.loopback || !isLoopbackAddress(listen?.address ?? '');
      // A shared address (100.64/10) comes back only if the person confirmed the warning for it.
      const confirmed = listen !== undefined && (!isSharedAddress(listen.address) || listen.sharedOk === true);
      if (listen !== undefined && allowed && confirmed) {
        const failure = await host.listen(listen.address, listen.port);
        if (failure !== undefined)
          this.deps.log.warn(`Modo time: não foi possível voltar a escutar em ${listen.address}:${listen.port}`);
      }
    } else if (this.store.joined !== undefined) this.createMember(this.store.joined).start();
  }

  async stop(): Promise<void> {
    await this.member?.stop();
    await this.host?.stop();
  }

  /** Once a second: the current share goes to the host side or the connection. */
  tick(): void {
    if (this.host === undefined && this.member === undefined) return;
    const share = buildTeamShare(this.deps.source(), this.store.settings.share, this.deps.now(), (kind, id) =>
      createHmac('sha256', Buffer.from(this.store.settings.keySalt, 'hex'))
        .update(`${kind}:${id}`)
        .digest('hex')
        .slice(0, 16),
    );
    this.host?.setLocalShare(share);
    this.member?.setShare(share);
  }

  // ---- what the page sees ------------------------------------------------------------------------------------------

  /** The team for the snapshot; undefined when this computer is not in one. */
  snapshot(): TeamSnapshot | undefined {
    const paused = this.store.settings.share.paused;
    if (this.host !== undefined)
      return {
        role: 'host',
        teamName: this.host.teamName,
        link: this.host.listening ? 'listening' : 'stopped',
        ...(this.host.error !== undefined ? { error: this.host.error } : {}),
        paused,
        people: this.host.people(),
      };
    if (this.member !== undefined)
      return {
        role: 'member',
        teamName: this.member.teamName,
        link: this.member.link,
        ...(this.member.error !== undefined ? { error: this.member.error } : {}),
        paused,
        people: this.member.people(),
      };
    return undefined;
  }

  status(): TeamStatus {
    const status: TeamStatus = {
      available: !this.deps.disabled,
      role: this.host !== undefined ? 'host' : this.member !== undefined ? 'member' : null,
      sharing: this.store.settings.share,
      interfaces: lanInterfaces(this.deps.loopback),
    };
    if (this.host !== undefined) {
      const bound = this.host.address;
      const pairing = this.host.pairing();
      status.host = {
        teamName: this.host.teamName,
        hostName: this.host.hostName,
        link: this.host.listening ? 'listening' : 'stopped',
        ...(bound !== undefined ? { address: bound.address, port: bound.port } : {}),
        ...(pairing !== undefined ? { pairing } : {}),
        fingerprint: this.host.fingerprint,
        members: this.host.members(),
        ...(this.host.error !== undefined ? { error: this.host.error } : {}),
      };
    } else if (this.member !== undefined && this.store.joined !== undefined) {
      const file = this.store.joined;
      status.member = {
        teamName: this.member.teamName,
        name: file.name,
        hostName: file.hostName,
        hostAddress: file.address,
        hostPort: file.port,
        hostFingerprint: this.member.hostFingerprint,
        link: this.member.link,
        ...(this.member.error !== undefined ? { error: this.member.error } : {}),
      };
    }
    return status;
  }

  // ---- hosting -----------------------------------------------------------------------------------------------------

  /** Starts (or restarts) the listener, creating the team the first time, and opens a pairing code. */
  startHosting(request: TeamHostStartRequest): Promise<PairingStatus> {
    return this.exclusive(async () => {
      this.guard('host');
      const name = cleanLine(request.name, TEAM_NAME_MAX);
      if (name === undefined) throw new TeamActionError('invalid-name');
      const port = request.port ?? TEAM_DEFAULT_PORT;
      if (!isValidPort(port)) throw new TeamActionError('invalid-port');
      const address = request.address;
      if (typeof address !== 'string' || !isTeamAddress(address) || (isLoopbackAddress(address) && !this.deps.loopback))
        throw new TeamActionError('invalid-address');
      const shared = isSharedAddress(address);
      // 100.64/10 may be a carrier-grade NAT shared with strangers: listening there needs an explicit confirmation.
      if (shared && request.allowShared !== true) throw new TeamActionError('shared-address');
      if (!isOwnAddress(address)) throw new TeamActionError('address-not-available');
      const teamName = cleanLine(request.teamName, TEAM_TEAMNAME_MAX);
      const device = this.deviceName(request.device);
      try {
        const host = this.host ?? this.createHost(await this.createHostFile(name, teamName ?? name, device));
        await host.setNames({ hostName: name, hostDevice: device, ...(teamName !== undefined ? { teamName } : {}) });
        const failure = await host.listen(address, port);
        if (failure !== undefined) throw new TeamActionError(failure);
        await host.setListen({ address, port, ...(shared ? { sharedOk: true as const } : {}) });
        return await host.newCode();
      } finally {
        this.deps.onChange();
      }
    });
  }

  stopHosting(): Promise<void> {
    return this.exclusive(async () => {
      const host = this.requireHost();
      await host.stop();
      await host.setListen(undefined);
    });
  }

  newCode(): Promise<PairingStatus> {
    return this.exclusive(async () => {
      const host = this.requireHost();
      if (!host.listening) throw new TeamActionError('not-hosting');
      return host.newCode();
    });
  }

  revoke(memberId: string): Promise<void> {
    return this.exclusive(async () => {
      const host = this.requireHost();
      if (typeof memberId !== 'string' || !(await host.revoke(memberId))) throw new TeamActionError('unknown-member');
    });
  }

  /** Ends the team: members are told, the listener closes, the identity and the member list are deleted. */
  endTeam(): Promise<void> {
    return this.exclusive(async () => {
      const host = this.requireHost();
      // `end` waits for every pending change to the file and refuses new ones, so nothing can write it back.
      await host.end();
      this.host = undefined;
      await this.store.deleteHost();
      this.deps.onChange();
    });
  }

  // ---- joining -----------------------------------------------------------------------------------------------------

  join(request: TeamJoinRequest): Promise<void> {
    return this.exclusive(async () => {
      this.guard('member');
      const name = cleanLine(request.name, TEAM_NAME_MAX);
      if (name === undefined) throw new TeamActionError('invalid-name');
      const target = parseHostPort(String(request.address ?? ''), request.port ?? TEAM_DEFAULT_PORT);
      if (target === undefined || (isLoopbackAddress(target.address) && !this.deps.loopback))
        throw new TeamActionError('invalid-address');
      const code = normalizePairingCode(String(request.code ?? ''));
      if (!isValidPairingCode(code)) throw new TeamActionError('invalid-code');
      try {
        const identity = newIdentity();
        const device = this.deviceName(request.device);
        const paired = await pairWithHost(target.address, target.port, {
          code,
          name,
          device,
          identity,
          ...(this.deps.stretch !== undefined ? { stretch: this.deps.stretch } : {}),
        });
        const file: JoinedFile = {
          teamId: paired.teamId,
          teamName: paired.teamName,
          memberId: paired.memberId,
          name,
          device,
          identity: exportIdentity(identity),
          hostPub: toB64(paired.hostPub),
          hostName: paired.hostName,
          address: target.address,
          port: target.port,
        };
        if (!(await this.store.saveJoined(file))) throw new TeamActionError('save-failed');
        this.createMember(file).start();
      } catch (error) {
        throw error instanceof ProtocolError ? new TeamActionError(error.code) : error;
      } finally {
        this.deps.onChange();
      }
    });
  }

  /** Leaves the team: the host is told, the keys are deleted. */
  leave(): Promise<void> {
    return this.exclusive(async () => {
      const member = this.member;
      if (member === undefined) throw new TeamActionError('not-member');
      await member.leave();
      this.member = undefined;
      await this.store.deleteJoined();
      this.deps.onChange();
    });
  }

  // ---- sharing -----------------------------------------------------------------------------------------------------

  setSharing(raw: unknown): Promise<TeamSharePrefs> {
    return this.exclusive(async () => {
      const share = parseSharePrefs(raw);
      if (!(await this.store.saveSettings({ ...this.store.settings, share }))) throw new TeamActionError('save-failed');
      this.tick();
      this.deps.onChange();
      return share;
    });
  }

  // ---- internals ---------------------------------------------------------------------------------------------------

  /**
   * How this computer is called in the team: what the person typed, else AI_OFFICE_TEAM_DEVICE, else a neutral label
   * (never the host name, which often holds a person's name). It is shared with the whole team.
   */
  private deviceName(requested?: string): string {
    const neutral = `PC-${this.store.settings.keySalt.slice(0, 4)}`;
    return cleanLine(requested, TEAM_DEVICE_MAX) ?? cleanLine(this.deps.device, TEAM_DEVICE_MAX) ?? neutral;
  }

  private guard(wanted: 'host' | 'member'): void {
    if (this.deps.disabled) throw new TeamActionError('team-disabled');
    if (this.member !== undefined) throw new TeamActionError('already-member');
    if (wanted === 'member' && this.host !== undefined) throw new TeamActionError('already-host');
  }

  private requireHost(): TeamHost {
    if (this.deps.disabled) throw new TeamActionError('team-disabled');
    if (this.host === undefined) throw new TeamActionError('not-host');
    return this.host;
  }

  private async createHostFile(hostName: string, teamName: string, hostDevice: string): Promise<HostFile> {
    const file: HostFile = {
      teamId: randomBytes(12).toString('base64url'),
      teamName,
      hostName,
      hostDevice,
      identity: exportIdentity(newIdentity()),
      members: [],
      revoked: [],
    };
    if (!(await this.store.saveHost(file))) throw new TeamActionError('save-failed');
    return file;
  }

  private createHost(file: HostFile): TeamHost {
    const host = new TeamHost(file, {
      now: this.deps.now,
      log: this.deps.log,
      save: (next) => this.store.saveHost(next),
      onChange: this.deps.onChange,
      ...(this.deps.stretch !== undefined ? { stretch: this.deps.stretch } : {}),
      ...this.deps.hostOptions,
    });
    this.host = host;
    return host;
  }

  private createMember(file: JoinedFile): TeamMember {
    const member = new TeamMember(file, {
      now: this.deps.now,
      log: this.deps.log,
      onChange: this.deps.onChange,
      ...(this.deps.delayScale !== undefined ? { delayScale: this.deps.delayScale } : {}),
    });
    this.member = member;
    return member;
  }
}
