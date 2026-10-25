// Team mode ("Modo time"): several computers in one office over the local network. These are the shapes that cross the
// wire between machines (a sanitized share and the merged team view), the status the page manages the mode with, and
// the part of the snapshot the worlds draw. Every time on the wire is an age (milliseconds ago), never a clock reading,
// so the machines need not agree on the time.
import type { AgentLook } from '../customization/types';
import type { Msg } from '../i18n/i18n';
import type { ActivityKind, AgentSource } from '../model';

export const TEAM_PROTOCOL_VERSION = 1;
/** Default port of the team listener (the web app stays on its own, loopback-only port). */
export const TEAM_DEFAULT_PORT = 4849;

export const TEAM_MAX_MEMBERS = 16;
export const TEAM_MAX_AGENTS = 40;
export const TEAM_MAX_ROOMS = 16;
export const TEAM_NAME_MAX = 24;
export const TEAM_DEVICE_MAX = 32;
export const TEAM_TEAMNAME_MAX = 32;
export const TEAM_TEXT_MAX = 80;

/** Pairing code: 8 characters, single use, valid for 10 minutes, destroyed after 5 wrong proofs. */
export const PAIRING_CODE_LENGTH = 8;
export const PAIRING_TTL_MS = 10 * 60_000;
export const PAIRING_MAX_FAILURES = 5;

export type TeamRole = 'host' | 'member';

/** What a member shares with the team. Everything optional is off until the person turns it on. */
export interface TeamSharePrefs {
  /** Stop sharing: the member stays in the team and online, but shows nobody. */
  paused: boolean;
  /** Real room names (alias or folder name) instead of "Projeto 1/2…". */
  projectNames: boolean;
  /** What each agent is doing in words ("Editando App.tsx"): may contain file names and command heads. */
  activityText: boolean;
  /** The session title (usually the first prompt). */
  titles: boolean;
  /** The git branch of each agent. */
  branches: boolean;
  /** Tokens and estimated cost of each agent. */
  usage: boolean;
}

export const DEFAULT_TEAM_SHARE: TeamSharePrefs = {
  paused: false,
  projectNames: false,
  activityText: false,
  titles: false,
  branches: false,
  usage: false,
};

export const SHARE_CATEGORIES = ['projectNames', 'activityText', 'titles', 'branches', 'usage'] as const;
export type ShareCategory = (typeof SHARE_CATEGORIES)[number];

export type SharedStatus = 'working' | 'waiting' | 'idle';

export interface SharedAgent {
  /** Opaque and stable on one device (a keyed hash of the session): it reveals nothing about the session. */
  key: string;
  /** The name shown in the member's office (the personalized one when set). */
  name: string;
  roomKey: string;
  kind: 'main' | 'sub';
  status: SharedStatus;
  /** How long ago the status began. */
  sinceAgeMs: number;
  look: 'f' | 'm';
  appearance?: AgentLook;
  source?: AgentSource;
  /** The kind of the current activity: the only thing said about it unless `activityText` is on. */
  activityKind?: ActivityKind;
  // ---- opt-in categories -------------------------------------------------------------------------------------------
  activityText?: string;
  activityMsg?: Msg;
  title?: string;
  branch?: string;
  tokens?: number;
  costUSD?: number;
}

export interface SharedRoom {
  key: string;
  /** 1-based position among the member's shared rooms: "Projeto {index}". */
  index: number;
  /** Only with `projectNames`. */
  name?: string;
}

export interface TeamShare {
  rooms: SharedRoom[];
  agents: SharedAgent[];
  /** The member paused sharing: no rooms, no agents. */
  paused?: true;
}

export const EMPTY_TEAM_SHARE: TeamShare = { rooms: [], agents: [] };

// ---- the merged view the host sends to every member ---------------------------------------------------------------------

export interface TeamViewMember {
  id: string;
  name: string;
  device: string;
  host: boolean;
  online: boolean;
  /** Offline members: how long ago they were last seen. */
  lastSeenAgoMs?: number;
  share?: TeamShare;
}

export interface TeamViewMsg {
  teamName: string;
  members: TeamViewMember[];
}

// ---- what the page draws -----------------------------------------------------------------------------------------------

export type TeamLink =
  /** Host: the team listener is open. */
  | 'listening'
  /** Host: the listener is off (the team and its members are kept). */
  | 'stopped'
  | 'connecting'
  | 'connected'
  /** Member: the host cannot be reached; trying again with a growing delay. */
  | 'offline'
  /** Member: the host will not take this device (removed, team ended, key changed, newer protocol). Needs the person. */
  | 'rejected';

export interface TeamAgent extends SharedAgent {
  /** When the status began, on this computer's clock. */
  since: number;
}

export interface TeamPerson {
  id: string;
  name: string;
  device: string;
  host: boolean;
  online: boolean;
  /** When an offline person was last seen, on this computer's clock. */
  lastSeenAt?: number;
  paused: boolean;
  rooms: SharedRoom[];
  agents: TeamAgent[];
}

/** The team as the worlds and the sidebar see it (OfficeSnapshot.team). The people are the others, never this computer. */
export interface TeamSnapshot {
  role: TeamRole;
  teamName: string;
  link: TeamLink;
  error?: TeamErrorCode;
  /** This computer's sharing is paused. */
  paused: boolean;
  people: TeamPerson[];
}

// ---- management (REST, local only) -----------------------------------------------------------------------------------

export type TeamErrorCode =
  | 'local-only'
  | 'team-disabled'
  | 'invalid-body'
  | 'invalid-address'
  | 'invalid-port'
  | 'invalid-name'
  | 'invalid-code'
  | 'already-host'
  | 'already-member'
  | 'not-host'
  | 'not-member'
  | 'not-hosting'
  | 'address-not-available'
  | 'listen-failed'
  | 'unknown-member'
  | 'unreachable'
  | 'timeout'
  | 'not-pairing'
  | 'pairing-failed'
  | 'pairing-locked'
  | 'rate-limited'
  | 'version-mismatch'
  | 'revoked'
  | 'ended'
  | 'host-key-changed'
  | 'replaced'
  | 'protocol-error'
  | 'team-full'
  | 'save-failed';

export interface LanInterface {
  /** Interface name ("en0"). */
  name: string;
  /** IPv4 address a team may listen on. */
  address: string;
}

export interface HostMember {
  id: string;
  name: string;
  device: string;
  online: boolean;
  createdAt: number;
  lastSeenAt?: number;
}

export interface PairingStatus {
  /** `ABCD-EFGH`. */
  code: string;
  expiresAt: number;
  /** Too many wrong proofs: the code is dead; make a new one. */
  locked: boolean;
}

export interface HostStatus {
  teamName: string;
  hostName: string;
  link: 'listening' | 'stopped';
  address?: string;
  port?: number;
  pairing?: PairingStatus;
  members: HostMember[];
  error?: TeamErrorCode;
}

export interface MemberStatus {
  teamName: string;
  name: string;
  hostName?: string;
  hostAddress: string;
  hostPort: number;
  link: TeamLink;
  error?: TeamErrorCode;
}

export interface TeamStatus {
  /** False when the server was started with AI_OFFICE_TEAM=0. */
  available: boolean;
  role: TeamRole | null;
  sharing: TeamSharePrefs;
  interfaces: LanInterface[];
  host?: HostStatus;
  member?: MemberStatus;
}

export interface TeamHostStartRequest {
  address: string;
  port?: number;
  teamName?: string;
  /** How the host appears to the others. */
  name: string;
}

export interface TeamJoinRequest {
  address: string;
  port?: number;
  code: string;
  name: string;
}
