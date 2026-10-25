import { fnv1a } from '../hash';
import { hslToHex } from '../colors';

const MEMBER_HUES = 12;

/** The color that identifies a team member everywhere (chips, room trim): one of 12 hues, from the member id. */
export function memberColor(memberId: string): string {
  const slot = fnv1a(memberId) % MEMBER_HUES;
  return hslToHex(slot * (360 / MEMBER_HUES) + 8, 0.66, 0.52);
}

/** One letter for a member chip. */
export function memberInitial(name: string): string {
  return (Array.from(name.trim())[0] ?? '?').toUpperCase();
}

/** Prefix of the ids of remote projects, agents and accounts in the page: they never collide with local ones. */
export const TEAM_ID_PREFIX = 'team:';

export function isTeamId(id: string): boolean {
  return id.startsWith(TEAM_ID_PREFIX);
}
