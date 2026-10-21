// Display texts of the office model in the current language. The server and the demo send a pt-BR `text` plus an
// optional `Msg` (key + params); everything shown to the user goes through here so a language switch re-renders it.
// Text that comes from real sessions (prompts, titles, commands, file names) has no `Msg` and is shown as it is.
import type {
  Account,
  Activity,
  Agent,
  Msg,
  PermissionRequest,
  ShellJob,
  TaskItem,
  TranscriptEntry,
} from '@ai-office/shared';
import { t, tm, type TextKey, type TextParams } from '../i18n';

const MAX_PARAM_DEPTH = 4;

function isParam(value: unknown, depth: number): boolean {
  if (typeof value === 'string' || typeof value === 'number') return true;
  return depth < MAX_PARAM_DEPTH && isMsg(value, depth + 1);
}

/** Structural check for a message coming over the network (never trust external data). */
export function isMsg(value: unknown, depth = 0): value is Msg {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as { key?: unknown; params?: unknown };
  if (typeof record.key !== 'string') return false;
  if (record.params === undefined) return true;
  if (typeof record.params !== 'object' || record.params === null || Array.isArray(record.params)) return false;
  return Object.values(record.params).every((param) => isParam(param, depth));
}

/** The message in the current language, or the server's pt-BR `fallback` text when it has none (or it is malformed). */
export function localized(message: unknown, fallback: string): string {
  return isMsg(message) ? tm(message, fallback) : fallback;
}

/** Same as `localized`, for optional texts. */
export function localizedOptional(message: unknown, fallback: string | undefined): string | undefined {
  return fallback === undefined && !isMsg(message) ? undefined : localized(message, fallback ?? '');
}

export function activityText(activity: Pick<Activity, 'text' | 'msg'>): string {
  return localized(activity.msg, activity.text);
}

export function activityDetail(activity: Pick<Activity, 'detail' | 'detailMsg'>): string | undefined {
  return localizedOptional(activity.detailMsg, activity.detail);
}

/** "Principal" is the role of main agents; subagents carry their type ("Explore"). */
export function agentRole(agent: Pick<Agent, 'role' | 'roleMsg'>): string {
  return localized(agent.roleMsg, agent.role);
}

/** Role label for lists: main agents are "Principal"/"Main" (only localized, not repeated per row). */
export function agentKindLabel(agent: Pick<Agent, 'kind' | 'role' | 'roleMsg'>): string {
  return agent.kind === 'main' ? t('agent.main') : agentRole(agent);
}

export function agentTitle(agent: Pick<Agent, 'title' | 'titleMsg'>): string | undefined {
  return localizedOptional(agent.titleMsg, agent.title);
}

export function agentWaitingFor(agent: Pick<Agent, 'waitingFor' | 'waitingForMsg'>): string | undefined {
  return localizedOptional(agent.waitingForMsg, agent.waitingFor);
}

export function taskTitle(task: Pick<TaskItem, 'title' | 'titleMsg'>): string {
  return localized(task.titleMsg, task.title);
}

/** What to show for a task: the "doing…" form while it is in progress. */
export function taskLabel(
  task: Pick<TaskItem, 'title' | 'titleMsg' | 'activeForm' | 'activeFormMsg' | 'status'>,
): string {
  if (task.status === 'in_progress') {
    const active = localizedOptional(task.activeFormMsg, task.activeForm);
    if (active) return active;
  }
  return taskTitle(task);
}

export function shellLabel(shell: Pick<ShellJob, 'label' | 'labelMsg'>): string {
  return localized(shell.labelMsg, shell.label);
}

export function permissionSummary(permission: Pick<PermissionRequest, 'summary' | 'summaryMsg'>): string {
  return localized(permission.summaryMsg, permission.summary);
}

export function permissionSuggestion(
  permission: Pick<PermissionRequest, 'suggestions' | 'suggestionMsgs'>,
  index: number,
): string {
  return localized(permission.suggestionMsgs?.[index], permission.suggestions[index] ?? '');
}

/** The default account is labelled by the client ("Pessoal", "Personal"); others keep their folder name. */
export function accountLabel(account: Pick<Account, 'label' | 'labelMsg' | 'isDefault'>): string {
  return account.isDefault === true ? t('account.default') : localized(account.labelMsg, account.label);
}

/** A message built from an app catalog key, to hand to code that re-renders it when the language changes. */
export function uiMsg(key: TextKey, params?: TextParams): Msg {
  return params === undefined ? { key } : { key, params };
}

/** The letter of the account chip; follows the localized label for the default account. */
export function accountInitial(account: Pick<Account, 'label' | 'labelMsg' | 'initial' | 'isDefault'>): string {
  return account.isDefault === true
    ? accountLabel(account).trim().slice(0, 1).toUpperCase() || account.initial
    : account.initial;
}

/** Summary line of a tool entry of the terminal: the icon and the localized text when the server sent a message. */
export function toolSummary(entry: Extract<TranscriptEntry, { kind: 'tool' }>): string {
  if (!isMsg(entry.summaryMsg)) return entry.summary;
  const text = tm(entry.summaryMsg, entry.summary);
  return entry.icon ? `${entry.icon} ${text}` : text;
}
