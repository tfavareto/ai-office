// Words for team mode: errors by code, the state of the connection, and the one-line status of a person.
import type { TeamErrorCode, TeamLink, TeamPerson } from '@ai-office/shared';
import { t } from '../../i18n';
import { TeamRejectedError, describeError } from '../../net/backend';
import { statusLabel } from './status';
import type { DisplayStatus } from './status';

export function teamCodeText(code: TeamErrorCode): string {
  return t(`team.error.${code}` as 'team.error.generic');
}

/** The explanation of a failed team action, in the user's language. */
export function teamErrorText(error: unknown): string {
  return error instanceof TeamRejectedError ? teamCodeText(error.code) : describeError(error);
}

export function linkText(link: TeamLink): string {
  return t(`team.link.${link}` as 'team.link.connected');
}

/** Whether the link is healthy (green), pending (amber) or broken (red), for the status dot. */
export function linkTone(link: TeamLink): 'ok' | 'wait' | 'bad' {
  if (link === 'connected' || link === 'listening') return 'ok';
  return link === 'connecting' || link === 'offline' ? 'wait' : 'bad';
}

/** `online`, `paused` or `offline`: what to say about a person at a glance. */
export function presenceOf(person: Pick<TeamPerson, 'online' | 'paused'>): 'online' | 'paused' | 'offline' {
  if (!person.online) return 'offline';
  return person.paused ? 'paused' : 'online';
}

/** What a teammate's agent is doing, in words: "needs you" would be wrong for somebody else's agent. */
export function remoteStatusLabel(status: DisplayStatus): string {
  return status === 'waiting' ? t('team.status.waiting') : statusLabel(status);
}
