// Defensive parsing of GET/POST /api/codex/settings and of the `source` the snapshot puts on accounts and agents.
import type { Account, Agent, AgentSource, CodexSettings } from '@ai-office/shared';
import { t } from '../i18n';
import { isRecord } from './parse';

export function parseCodexSettings(data: unknown): CodexSettings {
  if (!isRecord(data) || typeof data.sessions !== 'boolean') throw new Error(t('error.invalidResponse'));
  return { sessions: data.sessions, available: data.available === true, locked: data.locked === true };
}

/** Only the sources this build knows; anything else counts as Claude Code (absent). */
export function parseSource(value: unknown): AgentSource | undefined {
  return value === 'codex' ? 'codex' : undefined;
}

/** An account from the snapshot with its `source` validated. */
export function normalizeAccount(raw: Record<string, unknown>): Account {
  const { source, ...rest } = raw;
  const known = parseSource(source);
  return { ...(rest as unknown as Account), ...(known !== undefined ? { source: known } : {}) };
}

/** The agent without an unknown `source`. */
export function withValidSource(agent: Agent): Agent {
  const { source, ...rest } = agent;
  const known = parseSource(source);
  return known === undefined ? rest : { ...rest, source: known };
}
