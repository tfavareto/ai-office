// The on-disk shape of rules.json and rules-log.json: a schema version, tolerant reading (what cannot be read is
// dropped, never trusted), and the policy re-check that disables an allow rule the current policy would refuse.
import type { AutoDecision, AutoDecisionOutcome, Rule, RuleBlockReason } from '../model';
import { MAX_LOG_ENTRIES, MAX_RULES } from './rule-book';
import { MATCHER_KINDS, checkRuleDraft } from './validate';

export const RULES_SCHEMA_VERSION = 1;

export type StoredStatus = 'ok' | 'migrated' | 'unreadable' | 'newer-version';

export interface ParsedRules {
  status: StoredStatus;
  rules: Rule[];
  /** Entries that could not be read. */
  dropped: number;
  /** Allow rules switched off because the safety policy refuses them. */
  disabled: number;
}

export interface ParsedLog {
  status: StoredStatus;
  entries: AutoDecision[];
}

const OUTCOMES: readonly AutoDecisionOutcome[] = ['allow', 'deny', 'ask'];
const BLOCK_REASONS: readonly RuleBlockReason[] = [
  'delete',
  'sudo',
  'force-push',
  'reset',
  'permissions',
  'pipe-shell',
  'disk',
  'data',
  'sensitive-file',
  'inline-code',
];
const ID_PATTERN = /^[\w-]{1,64}$/;
const POLICY_CODES: readonly string[] = ['matcher-compound', 'matcher-too-broad', 'matcher-dangerous'];

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/** Reads one stored rule. A structurally valid allow rule that fails today's policy is kept, but switched off. */
function parseRule(raw: unknown): { rule: Rule; disabled: boolean } | undefined {
  if (!isRecord(raw) || typeof raw.id !== 'string' || !ID_PATTERN.test(raw.id)) return undefined;
  const strict = checkRuleDraft(raw);
  const relaxed = strict.ok
    ? strict
    : POLICY_CODES.includes(strict.error.code)
      ? checkRuleDraft(raw, { enforcePolicy: false })
      : strict;
  if (!relaxed.ok) return undefined;
  const refused = !strict.ok;
  const hits = finiteNumber(raw.hits);
  const lastHitAt = finiteNumber(raw.lastHitAt);
  const rule: Rule = {
    ...relaxed.draft,
    enabled: refused ? false : relaxed.draft.enabled,
    id: raw.id,
    createdAt: finiteNumber(raw.createdAt) ?? 0,
    hits: hits !== undefined && hits >= 0 ? Math.floor(hits) : 0,
    ...(lastHitAt !== undefined ? { lastHitAt } : {}),
  };
  return { rule, disabled: refused };
}

/** The list of the file: `{ version, rules }`, or a bare array written before versions existed. */
function rulesListOf(raw: unknown): { list: unknown[]; legacy: boolean } | 'newer-version' | undefined {
  if (Array.isArray(raw)) return { list: raw, legacy: true };
  if (!isRecord(raw)) return undefined;
  const version = finiteNumber(raw.version);
  if (version === undefined || version < 1)
    return Array.isArray(raw.rules) ? { list: raw.rules, legacy: true } : undefined;
  if (version > RULES_SCHEMA_VERSION) return 'newer-version';
  return Array.isArray(raw.rules) ? { list: raw.rules, legacy: false } : undefined;
}

export function parseRulesFile(raw: unknown): ParsedRules {
  const found = rulesListOf(raw);
  if (found === undefined) return { status: 'unreadable', rules: [], dropped: 0, disabled: 0 };
  if (found === 'newer-version') return { status: 'newer-version', rules: [], dropped: 0, disabled: 0 };
  const rules: Rule[] = [];
  const ids = new Set<string>();
  let dropped = 0;
  let disabled = 0;
  for (const item of found.list.slice(0, MAX_RULES * 2)) {
    const parsed = parseRule(item);
    if (parsed === undefined || ids.has(parsed.rule.id) || rules.length >= MAX_RULES) {
      dropped++;
      continue;
    }
    ids.add(parsed.rule.id);
    rules.push(parsed.rule);
    if (parsed.disabled) disabled++;
  }
  return { status: found.legacy ? 'migrated' : 'ok', rules, dropped, disabled };
}

export function serializeRules(rules: readonly Rule[]): { version: number; rules: readonly Rule[] } {
  return { version: RULES_SCHEMA_VERSION, rules };
}

function parseEntry(raw: unknown): AutoDecision | undefined {
  if (!isRecord(raw) || typeof raw.id !== 'string' || !ID_PATTERN.test(raw.id)) return undefined;
  const at = finiteNumber(raw.at);
  const outcome = OUTCOMES.find((candidate) => candidate === raw.outcome);
  const effect = raw.effect === 'allow' || raw.effect === 'deny' ? raw.effect : undefined;
  const kind = isRecord(raw.matcher)
    ? MATCHER_KINDS.find((candidate) => candidate === (raw.matcher as Record<string, unknown>).kind)
    : undefined;
  const matcher =
    kind !== undefined && typeof (raw.matcher as Record<string, unknown>).value === 'string'
      ? { kind, value: (raw.matcher as Record<string, string>).value }
      : undefined;
  if (at === undefined || outcome === undefined || effect === undefined || matcher === undefined) return undefined;
  if (
    ![raw.ruleId, raw.tool, raw.requestTool, raw.subject, raw.agentId, raw.agentName].every(
      (field) => typeof field === 'string',
    )
  )
    return undefined;
  const blockedBy = BLOCK_REASONS.find((reason) => reason === raw.blockedBy);
  return {
    id: raw.id,
    at,
    outcome,
    ruleId: raw.ruleId as string,
    effect,
    tool: raw.tool as string,
    matcher,
    requestTool: raw.requestTool as string,
    subject: (raw.subject as string).slice(0, 300),
    agentId: raw.agentId as string,
    agentName: (raw.agentName as string).slice(0, 100),
    ...(typeof raw.projectPath === 'string' ? { projectPath: raw.projectPath } : {}),
    ...(typeof raw.accountId === 'string' ? { accountId: raw.accountId } : {}),
    ...(blockedBy !== undefined ? { blockedBy } : {}),
    ...(raw.demo === true ? { demo: true } : {}),
  };
}

export function parseLogFile(raw: unknown): ParsedLog {
  if (!isRecord(raw)) return { status: 'unreadable', entries: [] };
  const version = finiteNumber(raw.version);
  if (version !== undefined && version > RULES_SCHEMA_VERSION) return { status: 'newer-version', entries: [] };
  if (!Array.isArray(raw.entries)) return { status: 'unreadable', entries: [] };
  const entries = raw.entries.map(parseEntry).filter((entry): entry is AutoDecision => entry !== undefined);
  return { status: 'ok', entries: entries.slice(-MAX_LOG_ENTRIES) };
}

export function serializeLog(entries: readonly AutoDecision[]): { version: number; entries: readonly AutoDecision[] } {
  return { version: RULES_SCHEMA_VERSION, entries };
}
