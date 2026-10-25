// Defensive parsing of everything team mode sends the page: the `team` part of the snapshot and GET/POST /api/team.
import {
  DEFAULT_TEAM_SHARE,
  TEAM_DEVICE_MAX,
  TEAM_NAME_MAX,
  TEAM_TEAMNAME_MAX,
  cleanLine,
  parseSharePrefs,
  parseTeamShare,
  type HostMember,
  type HostStatus,
  type LanInterface,
  type MemberStatus,
  type TeamAgent,
  type TeamErrorCode,
  type TeamLink,
  type TeamPerson,
  type TeamSnapshot,
  type TeamStatus,
} from '@ai-office/shared';
import { t } from '../i18n';
import { isRecord } from './parse';

const LINKS: ReadonlySet<string> = new Set<TeamLink>([
  'listening',
  'stopped',
  'connecting',
  'connected',
  'offline',
  'rejected',
]);

const ERROR_CODES: ReadonlySet<string> = new Set<TeamErrorCode>([
  'local-only',
  'team-disabled',
  'invalid-body',
  'invalid-address',
  'invalid-port',
  'invalid-name',
  'invalid-code',
  'already-host',
  'already-member',
  'not-host',
  'not-member',
  'not-hosting',
  'address-not-available',
  'listen-failed',
  'unknown-member',
  'unreachable',
  'timeout',
  'not-pairing',
  'pairing-failed',
  'pairing-locked',
  'rate-limited',
  'version-mismatch',
  'revoked',
  'ended',
  'host-key-changed',
  'replaced',
  'protocol-error',
  'team-full',
  'shared-address',
  'save-failed',
]);

export function parseErrorCode(value: unknown): TeamErrorCode | undefined {
  return typeof value === 'string' && ERROR_CODES.has(value) ? (value as TeamErrorCode) : undefined;
}

function link(value: unknown): TeamLink | undefined {
  return typeof value === 'string' && LINKS.has(value) ? (value as TeamLink) : undefined;
}

function finite(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function parsePerson(raw: unknown): TeamPerson | undefined {
  if (!isRecord(raw) || typeof raw.id !== 'string' || raw.id.length === 0 || raw.id.length > 64) return undefined;
  const name = cleanLine(raw.name, TEAM_NAME_MAX);
  if (name === undefined) return undefined;
  const share = parseTeamShare({ rooms: raw.rooms, agents: raw.agents });
  const sinceByKey = new Map<string, number>();
  for (const agent of Array.isArray(raw.agents) ? raw.agents : [])
    if (isRecord(agent) && typeof agent.key === 'string' && finite(agent.since) !== undefined)
      sinceByKey.set(agent.key, agent.since as number);
  const lastSeenAt = finite(raw.lastSeenAt);
  return {
    id: raw.id,
    name,
    device: cleanLine(raw.device, TEAM_DEVICE_MAX) ?? '',
    host: raw.host === true,
    online: raw.online === true,
    ...(lastSeenAt !== undefined ? { lastSeenAt } : {}),
    paused: raw.paused === true,
    rooms: share?.rooms ?? [],
    agents: (share?.agents ?? []).map((agent): TeamAgent => ({ ...agent, since: sinceByKey.get(agent.key) ?? 0 })),
  };
}

/** The `team` field of a snapshot; undefined when absent or not a team. */
export function parseTeamSnapshot(raw: unknown): TeamSnapshot | undefined {
  if (!isRecord(raw) || (raw.role !== 'host' && raw.role !== 'member')) return undefined;
  const teamName = cleanLine(raw.teamName, TEAM_TEAMNAME_MAX);
  const state = link(raw.link);
  if (teamName === undefined || state === undefined) return undefined;
  const error = parseErrorCode(raw.error);
  return {
    role: raw.role,
    teamName,
    link: state,
    ...(error !== undefined ? { error } : {}),
    paused: raw.paused === true,
    people: (Array.isArray(raw.people) ? raw.people : []).flatMap((person) => parsePerson(person) ?? []),
  };
}

function parseInterfaces(raw: unknown): LanInterface[] {
  return (Array.isArray(raw) ? raw : []).flatMap((item) =>
    isRecord(item) && typeof item.name === 'string' && typeof item.address === 'string'
      ? [
          {
            name: item.name.slice(0, 32),
            address: item.address.slice(0, 45),
            ...(item.shared === true ? { shared: true } : {}),
          },
        ]
      : [],
  );
}

/** The short fingerprint of a key (`1a2b-3c4d-5e6f-7a8b`); empty when absent or not of that shape. */
function parseFingerprint(value: unknown): string {
  return typeof value === 'string' && /^[0-9a-f]{4}(-[0-9a-f]{4}){3}$/.test(value) ? value : '';
}

function parseHostMember(raw: unknown): HostMember | undefined {
  if (!isRecord(raw) || typeof raw.id !== 'string') return undefined;
  const name = cleanLine(raw.name, TEAM_NAME_MAX);
  const createdAt = finite(raw.createdAt);
  if (name === undefined || createdAt === undefined) return undefined;
  const lastSeenAt = finite(raw.lastSeenAt);
  return {
    id: raw.id,
    name,
    device: cleanLine(raw.device, TEAM_DEVICE_MAX) ?? '',
    online: raw.online === true,
    createdAt,
    ...(lastSeenAt !== undefined ? { lastSeenAt } : {}),
  };
}

function parseHost(raw: unknown): HostStatus | undefined {
  if (!isRecord(raw)) return undefined;
  const teamName = cleanLine(raw.teamName, TEAM_TEAMNAME_MAX);
  const hostName = cleanLine(raw.hostName, TEAM_NAME_MAX);
  if (teamName === undefined || hostName === undefined) return undefined;
  const pairing = isRecord(raw.pairing) ? raw.pairing : undefined;
  const error = parseErrorCode(raw.error);
  return {
    teamName,
    hostName,
    link: raw.link === 'listening' ? 'listening' : 'stopped',
    ...(typeof raw.address === 'string' ? { address: raw.address } : {}),
    ...(finite(raw.port) !== undefined ? { port: raw.port as number } : {}),
    ...(pairing !== undefined && typeof pairing.code === 'string' && finite(pairing.expiresAt) !== undefined
      ? { pairing: { code: pairing.code, expiresAt: pairing.expiresAt as number, locked: pairing.locked === true } }
      : {}),
    fingerprint: parseFingerprint(raw.fingerprint),
    members: (Array.isArray(raw.members) ? raw.members : []).flatMap((item) => parseHostMember(item) ?? []),
    ...(error !== undefined ? { error } : {}),
  };
}

function parseMember(raw: unknown): MemberStatus | undefined {
  if (!isRecord(raw)) return undefined;
  const teamName = cleanLine(raw.teamName, TEAM_TEAMNAME_MAX);
  const name = cleanLine(raw.name, TEAM_NAME_MAX);
  const state = link(raw.link);
  if (teamName === undefined || name === undefined || state === undefined) return undefined;
  if (typeof raw.hostAddress !== 'string' || finite(raw.hostPort) === undefined) return undefined;
  const hostName = cleanLine(raw.hostName, TEAM_NAME_MAX);
  const error = parseErrorCode(raw.error);
  return {
    teamName,
    name,
    ...(hostName !== undefined ? { hostName } : {}),
    hostAddress: raw.hostAddress,
    hostPort: raw.hostPort as number,
    hostFingerprint: parseFingerprint(raw.hostFingerprint),
    link: state,
    ...(error !== undefined ? { error } : {}),
  };
}

export function parseTeamStatus(data: unknown): TeamStatus {
  if (!isRecord(data) || typeof data.available !== 'boolean') throw new Error(t('error.invalidResponse'));
  const host = parseHost(data.host);
  const member = parseMember(data.member);
  return {
    available: data.available,
    role: data.role === 'host' || data.role === 'member' ? data.role : null,
    sharing: isRecord(data.sharing) ? parseSharePrefs(data.sharing) : { ...DEFAULT_TEAM_SHARE },
    interfaces: parseInterfaces(data.interfaces),
    ...(host !== undefined ? { host } : {}),
    ...(member !== undefined ? { member } : {}),
  };
}
