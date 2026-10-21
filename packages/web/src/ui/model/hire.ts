// Pure logic of the "hire an agent" dialog: which accounts and folders it offers, what it sends and how errors read.
import {
  type Account,
  DEMO_ACCOUNTS,
  HIRE_MAX_PROMPT,
  type HireCheckReason,
  type HireErrorCode,
  type HireModel,
  type HirePermissionMode,
  type HireRequest,
  type OfficeSnapshot,
  type RecentSession,
} from '@ai-office/shared';
import type { UiKey } from '../../i18n';
import { BackendError } from '../../net/backend';

/** What the dialog opens with: a room's folder (and maybe the desk that was clicked), or nothing for a new project. */
export interface HireTarget {
  projectPath?: string;
  deskIndex?: number;
}

export interface HireForm {
  /** Folder of the chosen room, or undefined for a new project (then `path` is used). */
  roomPath: string | undefined;
  path: string;
  accountId: string;
  prompt: string;
  model: HireModel;
  permissionMode: HirePermissionMode;
  deskIndex?: number;
}

export const RECENT_FOLDER_LIMIT = 6;

const DEMO_ACCOUNT_IDS: ReadonlySet<string> = new Set(DEMO_ACCOUNTS.map((account) => account.id));

/** Folders to suggest for a new project: the ones sessions ran in lately, newest first, without the folders that already are rooms. */
export function recentFolders(
  sessions: readonly RecentSession[],
  roomPaths: readonly string[],
  limit = RECENT_FOLDER_LIMIT,
): { path: string; name: string }[] {
  const skip = new Set(roomPaths);
  const newestFirst = [...sessions].sort((a, b) => b.lastAt - a.lastAt);
  const seen = new Set<string>();
  const folders: { path: string; name: string }[] = [];
  for (const session of newestFirst) {
    const path = session.projectPath;
    if (path === undefined || path === '' || skip.has(path) || seen.has(path)) continue;
    seen.add(path);
    folders.push({ path, name: session.projectName });
    if (folders.length >= limit) break;
  }
  return folders;
}

/** Rooms with real sessions: the folders hiring will really launch a terminal for. */
export function realRoomPaths(snapshot: OfficeSnapshot | null): string[] {
  if (!snapshot) return [];
  const real = new Set(snapshot.agents.filter((agent) => agent.demo !== true).map((agent) => agent.projectId));
  return snapshot.projects.filter((project) => real.has(project.id)).map((project) => project.path);
}

/** Demo mode simulates hires everywhere except in rooms that hold real sessions. */
export function isSimulatedHire(snapshot: OfficeSnapshot | null, projectPath: string): boolean {
  return snapshot?.meta.demo === true && !realRoomPaths(snapshot).includes(projectPath);
}

/** Accounts the dialog offers: the demo ones for a simulated hire, the real ones otherwise. */
export function hireAccounts(snapshot: OfficeSnapshot | null, simulated: boolean): Account[] {
  return (snapshot?.accounts ?? []).filter((account) => DEMO_ACCOUNT_IDS.has(account.id) === simulated);
}

/** The account to preselect: the one that worked most recently in the room, else the default account, else the first. */
export function defaultAccountId(
  snapshot: OfficeSnapshot | null,
  projectPath: string | undefined,
  accounts: readonly Account[],
): string {
  const offered = new Set(accounts.map((account) => account.id));
  const here = (snapshot?.agents ?? [])
    .filter((agent) => agent.projectId === projectPath && agent.kind === 'main' && offered.has(agent.accountId))
    .sort((a, b) => b.startedAt - a.startedAt)[0];
  return here?.accountId ?? accounts.find((account) => account.isDefault === true)?.id ?? accounts[0]?.id ?? '';
}

/** Quick check while typing, before asking the server: the server only takes absolute paths (and `~`). */
export function localPathProblem(path: string): HireCheckReason | null {
  const trimmed = path.trim();
  if (trimmed === '') return null;
  return trimmed.startsWith('/') || trimmed === '~' || trimmed.startsWith('~/') ? null : 'not-absolute';
}

export function promptTooLong(prompt: string): boolean {
  return prompt.length > HIRE_MAX_PROMPT;
}

/** The body for POST /api/agents/hire. The model and the permission mode are left out when they are the defaults. */
export function buildHireRequest(form: HireForm): HireRequest {
  const request: HireRequest = { projectPath: (form.roomPath ?? form.path).trim() };
  if (form.accountId !== '') request.accountId = form.accountId;
  const prompt = form.prompt.trim();
  if (prompt !== '') request.prompt = prompt;
  if (form.model !== 'default') request.model = form.model;
  if (form.permissionMode !== 'default') request.permissionMode = form.permissionMode;
  if (form.deskIndex !== undefined) request.deskIndex = form.deskIndex;
  return request;
}

/** Cmd+Enter on macOS, Ctrl+Enter elsewhere. */
export function isSubmitShortcut(
  event: Pick<KeyboardEvent, 'key' | 'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey'>,
): boolean {
  return event.key === 'Enter' && (event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey;
}

const ERROR_KEYS: Readonly<Partial<Record<HireErrorCode, UiKey>>> = {
  'rate-limited': 'hire.error.rateLimited',
  'invalid-projectPath': 'hire.error.invalidPath',
  'invalid-prompt': 'hire.error.invalidPrompt',
  'unknown-account': 'hire.error.unknownAccount',
  'project-not-found': 'hire.error.projectNotFound',
  'project-not-directory': 'hire.error.projectNotDirectory',
  'project-not-readable': 'hire.error.projectNotReadable',
  'claude-not-found': 'hire.error.claudeNotFound',
  'no-terminal': 'hire.error.noTerminal',
  'terminal-failed': 'hire.error.terminalFailed',
  'unsupported-platform': 'hire.error.unsupportedPlatform',
};

/** Catalog key that explains a failed hire, or null when the error is not one the server describes. */
export function hireErrorKey(error: unknown): UiKey | null {
  if (!(error instanceof BackendError)) return null;
  return ERROR_KEYS[error.message as HireErrorCode] ?? null;
}

const REASON_KEYS: Readonly<Record<HireCheckReason, UiKey>> = {
  'not-absolute': 'hire.path.notAbsolute',
  'not-found': 'hire.path.notFound',
  'not-directory': 'hire.path.notDirectory',
  'not-readable': 'hire.path.notReadable',
};

export function folderReasonKey(reason: HireCheckReason): UiKey {
  return REASON_KEYS[reason];
}
