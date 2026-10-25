// What team mode keeps on disk, in `<stateDir>/team/` (directory 0700, files 0600, written atomically):
//   host.json      the team this computer hosts: its Ed25519 identity, the members' PUBLIC keys, removed ids, the address
//   member.json    the team this computer joined: its own identity, the pinned public key of the host, the host's address
//   settings.json  what this computer shares, and the salt that makes the opaque ids of its agents unguessable
// The host keeps no secret of any member: it stores their public keys only.
import { randomBytes } from 'node:crypto';
import { chmod, mkdir, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import {
  DEFAULT_TEAM_SHARE,
  TEAM_DEVICE_MAX,
  TEAM_NAME_MAX,
  TEAM_TEAMNAME_MAX,
  cleanLine,
  isSafeKey,
  parseSharePrefs,
  type TeamSharePrefs,
} from '@ai-office/shared';
import type { Logger } from '../log';
import { asRecord, readJsonFile, writeJsonAtomic } from '../util/fs-safe';
import { isTeamAddress, isValidPort } from './addresses';
import { type StoredIdentity, fromB64 } from './keys';

const VERSION = 1;
const isId = (value: unknown): value is string => isSafeKey(value, 8, 32);
const MAX_REVOKED = 64;

export interface StoredMember {
  id: string;
  name: string;
  device: string;
  /** Ed25519 public key, base64. */
  pub: string;
  createdAt: number;
  lastSeenAt?: number;
}

export interface HostFile {
  teamId: string;
  teamName: string;
  hostName: string;
  hostDevice: string;
  identity: StoredIdentity;
  members: StoredMember[];
  revoked: string[];
  /** Where the listener was left: it comes back there when the app starts. */
  listen?: { address: string; port: number; sharedOk?: true };
}

export interface JoinedFile {
  teamId: string;
  teamName: string;
  memberId: string;
  name: string;
  device: string;
  identity: StoredIdentity;
  hostPub: string;
  hostName: string;
  address: string;
  port: number;
}

export interface SettingsFile {
  share: TeamSharePrefs;
  keySalt: string;
}

function identityOf(raw: unknown): StoredIdentity | undefined {
  const r = asRecord(raw);
  try {
    fromB64(r.pub, 32);
    fromB64(r.priv);
    return { pub: r.pub as string, priv: r.priv as string };
  } catch {
    return undefined;
  }
}

function memberOf(raw: unknown): StoredMember | undefined {
  const r = asRecord(raw);
  const name = cleanLine(r.name, TEAM_NAME_MAX);
  if (typeof r.id !== 'string' || !isId(r.id) || name === undefined) return undefined;
  try {
    fromB64(r.pub, 32);
  } catch {
    return undefined;
  }
  if (typeof r.createdAt !== 'number') return undefined;
  return {
    id: r.id,
    name,
    device: cleanLine(r.device, TEAM_DEVICE_MAX) ?? '',
    pub: r.pub as string,
    createdAt: r.createdAt,
    ...(typeof r.lastSeenAt === 'number' ? { lastSeenAt: r.lastSeenAt } : {}),
  };
}

export function readHostFile(raw: unknown): HostFile | undefined {
  const r = asRecord(raw);
  const identity = identityOf(r.identity);
  const teamName = cleanLine(r.teamName, TEAM_TEAMNAME_MAX);
  const hostName = cleanLine(r.hostName, TEAM_NAME_MAX);
  if (r.version !== VERSION || identity === undefined || teamName === undefined || hostName === undefined)
    return undefined;
  if (typeof r.teamId !== 'string' || !isId(r.teamId)) return undefined;
  const listen = asRecord(r.listen);
  const members = (Array.isArray(r.members) ? r.members : []).flatMap((item) => memberOf(item) ?? []);
  return {
    teamId: r.teamId,
    teamName,
    hostName,
    hostDevice: cleanLine(r.hostDevice, TEAM_DEVICE_MAX) ?? '',
    identity,
    members,
    revoked: (Array.isArray(r.revoked) ? r.revoked : [])
      .filter((id): id is string => typeof id === 'string' && isId(id))
      .slice(-MAX_REVOKED),
    ...(typeof listen.address === 'string' && isTeamAddress(listen.address) && isValidPort(listen.port)
      ? {
          listen: {
            address: listen.address,
            port: listen.port,
            ...(listen.sharedOk === true ? { sharedOk: true as const } : {}),
          },
        }
      : {}),
  };
}

export function readJoinedFile(raw: unknown): JoinedFile | undefined {
  const r = asRecord(raw);
  const identity = identityOf(r.identity);
  const teamName = cleanLine(r.teamName, TEAM_TEAMNAME_MAX);
  const name = cleanLine(r.name, TEAM_NAME_MAX);
  const hostName = cleanLine(r.hostName, TEAM_NAME_MAX);
  if (r.version !== VERSION || identity === undefined || teamName === undefined || name === undefined) return undefined;
  if (hostName === undefined) return undefined;
  if (typeof r.teamId !== 'string' || !isId(r.teamId) || typeof r.memberId !== 'string' || !isId(r.memberId))
    return undefined;
  if (typeof r.address !== 'string' || !isTeamAddress(r.address) || !isValidPort(r.port)) return undefined;
  try {
    fromB64(r.hostPub, 32);
  } catch {
    return undefined;
  }
  return {
    teamId: r.teamId,
    teamName,
    memberId: r.memberId,
    name,
    device: cleanLine(r.device, TEAM_DEVICE_MAX) ?? '',
    identity,
    hostPub: r.hostPub as string,
    hostName,
    address: r.address,
    port: r.port,
  };
}

export function readSettingsFile(raw: unknown): SettingsFile {
  const r = asRecord(raw);
  const salt =
    typeof r.keySalt === 'string' && /^[0-9a-f]{64}$/.test(r.keySalt) ? r.keySalt : randomBytes(32).toString('hex');
  return { share: r.version === VERSION ? parseSharePrefs(r.share) : { ...DEFAULT_TEAM_SHARE }, keySalt: salt };
}

export class TeamStore {
  host: HostFile | undefined;
  joined: JoinedFile | undefined;
  settings: SettingsFile = { share: { ...DEFAULT_TEAM_SHARE }, keySalt: randomBytes(32).toString('hex') };
  private readonly dir: string;

  constructor(
    stateDir: string,
    private readonly log: Logger,
  ) {
    this.dir = join(stateDir, 'team');
  }

  async load(): Promise<void> {
    const read = async (file: string): Promise<unknown> => readJsonFile(join(this.dir, file));
    this.host = readHostFile(await read('host.json'));
    this.joined = readJoinedFile(await read('member.json'));
    this.settings = readSettingsFile(await read('settings.json'));
    if (this.host !== undefined && this.joined !== undefined) {
      this.log.warn('Modo time: o computador está registrado como anfitrião e como membro; o membro foi ignorado.');
      this.joined = undefined;
    }
  }

  async saveHost(file: HostFile): Promise<boolean> {
    if (!(await this.write('host.json', { version: VERSION, ...file }))) return false;
    this.host = file;
    return true;
  }

  async saveJoined(file: JoinedFile): Promise<boolean> {
    if (!(await this.write('member.json', { version: VERSION, ...file }))) return false;
    this.joined = file;
    return true;
  }

  async saveSettings(settings: SettingsFile): Promise<boolean> {
    if (!(await this.write('settings.json', { version: VERSION, ...settings }))) return false;
    this.settings = settings;
    return true;
  }

  async deleteHost(): Promise<void> {
    await this.remove('host.json');
    this.host = undefined;
  }

  async deleteJoined(): Promise<void> {
    await this.remove('member.json');
    this.joined = undefined;
  }

  /** Deletes a file and any temporary file a failed write left next to it. */
  private async remove(file: string): Promise<void> {
    await rm(join(this.dir, file), { force: true });
    const leftovers = (await readdir(this.dir).catch(() => [])).filter(
      (name) => name.startsWith(`${file}.`) && name.endsWith('.tmp'),
    );
    await Promise.all(leftovers.map((name) => rm(join(this.dir, name), { force: true })));
  }

  private async write(file: string, value: unknown): Promise<boolean> {
    try {
      await mkdir(this.dir, { recursive: true, mode: 0o700 });
      await chmod(this.dir, 0o700);
      await writeJsonAtomic(join(this.dir, file), value);
      return true;
    } catch (error) {
      this.log.warn(`Modo time: não foi possível salvar ${file}: ${String(error)}`);
      return false;
    }
  }
}
