// Team mode as the rest of the server sees it: one object that owns the host or the member side, the stored state and
// the sharing preferences, and that the REST handlers and the snapshot publisher talk to. Off until the person turns it
// on: nothing listens and nothing connects until "host a team" or "join a team".
import { createHmac, randomBytes } from 'node:crypto';
import { hostname } from 'node:os';
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
import { isOwnAddress, isLoopbackAddress, isTeamAddress, isValidPort, lanInterfaces, parseHostPort } from './addresses';
import { TeamHost } from './host';
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
}

export class TeamService {
  private readonly store: TeamStore;
  private host: TeamHost | undefined;
  private member: TeamMember | undefined;
  private busy = false;

  constructor(private readonly deps: TeamServiceDeps) {
    this.store = new TeamStore(deps.stateDir, deps.log);
  }

  // ---- lifecycle ---------------------------------------------------------------------------------------------------

  /** Reads the stored state and brings back what the person left on (the listener, the connection). */
  async start(): Promise<void> {
    if (this.deps.disabled) return;
    await this.store.load();
    if (this.store.host !== undefined) {
      const host = this.createHost(this.store.host);
      const listen = this.store.host.listen;
      if (listen !== undefined && (this.deps.loopback || !isLoopbackAddress(listen.address))) {
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
        link: this.member.link,
        ...(this.member.error !== undefined ? { error: this.member.error } : {}),
      };
    }
    return status;
  }

  // ---- hosting -----------------------------------------------------------------------------------------------------

  /** Starts (or restarts) the listener, creating the team the first time, and opens a pairing code. */
  async startHosting(request: TeamHostStartRequest): Promise<PairingStatus> {
    this.guard('host');
    const name = cleanLine(request.name, TEAM_NAME_MAX);
    if (name === undefined) throw new TeamActionError('invalid-name');
    const port = request.port ?? TEAM_DEFAULT_PORT;
    if (!isValidPort(port)) throw new TeamActionError('invalid-port');
    const address = request.address;
    if (typeof address !== 'string' || !isTeamAddress(address) || (isLoopbackAddress(address) && !this.deps.loopback))
      throw new TeamActionError('invalid-address');
    if (!isOwnAddress(address)) throw new TeamActionError('address-not-available');
    const teamName = cleanLine(request.teamName, TEAM_TEAMNAME_MAX);
    this.busy = true;
    try {
      const host = this.host ?? this.createHost(await this.createHostFile(name, teamName ?? name));
      await host.setNames({ hostName: name, ...(teamName !== undefined ? { teamName } : {}) });
      const failure = await host.listen(address, port);
      if (failure !== undefined) throw new TeamActionError(failure);
      await host.setListen({ address, port });
      return await host.newCode();
    } finally {
      this.busy = false;
      this.deps.onChange();
    }
  }

  async stopHosting(): Promise<void> {
    const host = this.requireHost();
    await host.stop();
    await host.setListen(undefined);
  }

  async newCode(): Promise<PairingStatus> {
    const host = this.requireHost();
    if (!host.listening) throw new TeamActionError('not-hosting');
    return host.newCode();
  }

  async revoke(memberId: string): Promise<void> {
    const host = this.requireHost();
    if (typeof memberId !== 'string' || !(await host.revoke(memberId))) throw new TeamActionError('unknown-member');
  }

  /** Ends the team: members are told, the listener closes, the identity and the member list are deleted. */
  async endTeam(): Promise<void> {
    const host = this.requireHost();
    await host.end();
    this.host = undefined;
    await this.store.deleteHost();
    this.deps.onChange();
  }

  // ---- joining -----------------------------------------------------------------------------------------------------

  async join(request: TeamJoinRequest): Promise<void> {
    this.guard('member');
    const name = cleanLine(request.name, TEAM_NAME_MAX);
    if (name === undefined) throw new TeamActionError('invalid-name');
    const target = parseHostPort(String(request.address ?? ''), request.port ?? TEAM_DEFAULT_PORT);
    if (target === undefined || (isLoopbackAddress(target.address) && !this.deps.loopback))
      throw new TeamActionError('invalid-address');
    const code = normalizePairingCode(String(request.code ?? ''));
    if (!isValidPairingCode(code)) throw new TeamActionError('invalid-code');
    this.busy = true;
    try {
      const identity = newIdentity();
      const device = this.deviceName();
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
      this.busy = false;
      this.deps.onChange();
    }
  }

  /** Leaves the team: the host is told, the keys are deleted. */
  async leave(): Promise<void> {
    const member = this.member;
    if (member === undefined) throw new TeamActionError('not-member');
    await member.leave();
    this.member = undefined;
    await this.store.deleteJoined();
    this.deps.onChange();
  }

  // ---- sharing -----------------------------------------------------------------------------------------------------

  async setSharing(raw: unknown): Promise<TeamSharePrefs> {
    const share = parseSharePrefs(raw);
    if (!(await this.store.saveSettings({ ...this.store.settings, share }))) throw new TeamActionError('save-failed');
    this.tick();
    this.deps.onChange();
    return share;
  }

  // ---- internals ---------------------------------------------------------------------------------------------------

  private deviceName(): string {
    return cleanLine(this.deps.device ?? hostname().replace(/\.local$/i, ''), TEAM_DEVICE_MAX) ?? '';
  }

  private guard(wanted: 'host' | 'member'): void {
    if (this.deps.disabled) throw new TeamActionError('team-disabled');
    if (this.member !== undefined) throw new TeamActionError('already-member');
    if (wanted === 'member' && this.host !== undefined) throw new TeamActionError('already-host');
    if (this.busy) throw new TeamActionError('rate-limited');
  }

  private requireHost(): TeamHost {
    if (this.deps.disabled) throw new TeamActionError('team-disabled');
    if (this.host === undefined) throw new TeamActionError('not-host');
    return this.host;
  }

  private async createHostFile(hostName: string, teamName: string): Promise<HostFile> {
    const file: HostFile = {
      teamId: randomBytes(12).toString('base64url'),
      teamName,
      hostName,
      hostDevice: this.deviceName(),
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
