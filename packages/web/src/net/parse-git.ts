// Defensive parsing of the git state that travels in the snapshot and of GET/POST /api/git/settings: every number and
// text is checked and cut, anything unknown is dropped, and a link is only kept when it is an http(s) address.
import {
  GH_STATUSES,
  GIT_BRANCH_MAX,
  GIT_FAILING_MAX,
  GIT_OPERATIONS,
  GIT_SUBJECT_MAX,
  GIT_TITLE_MAX,
  type CiState,
  type GhStatus,
  type GitChecks,
  type GitCommit,
  type GitOperation,
  type GitPullRequest,
  type GitSettings,
  type ProjectGit,
  type PullRequestState,
  type ReviewDecision,
} from '@ai-office/shared';
import { t } from '../i18n';
import { isRecord } from './parse';

const MAX_COUNT = 1_000_000;
const MAX_URL = 500;
const CI_STATES: readonly CiState[] = ['none', 'success', 'pending', 'failure'];
const PR_STATES: readonly PullRequestState[] = ['open', 'merged', 'closed'];
const REVIEWS: readonly ReviewDecision[] = ['approved', 'changes-requested', 'review-required'];

function count(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.min(MAX_COUNT, Math.max(0, Math.trunc(value))) : 0;
}

function optionalCount(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? count(value) : undefined;
}

// Control characters (C0 and DEL) never reach the UI.
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/g;

function text(value: unknown, max: number): string | undefined {
  return typeof value === 'string' ? value.replace(CONTROL_CHARS, ' ').trim().slice(0, max) : undefined;
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[]): T | undefined {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value) ? (value as T) : undefined;
}

/** An address the page may link to: http or https only. */
export function safeHref(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length > MAX_URL) return undefined;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : undefined;
  } catch {
    return undefined;
  }
}

function parseChecks(value: unknown): GitChecks {
  const raw = isRecord(value) ? value : {};
  const failing = Array.isArray(raw.failing)
    ? raw.failing
        .map((name) => text(name, 80))
        .filter((name): name is string => name !== undefined && name.length > 0)
        .slice(0, GIT_FAILING_MAX)
    : [];
  return {
    total: count(raw.total),
    passed: count(raw.passed),
    failed: count(raw.failed),
    pending: count(raw.pending),
    ...(failing.length > 0 ? { failing } : {}),
  };
}

function parsePullRequest(value: unknown): GitPullRequest | undefined {
  if (!isRecord(value)) return undefined;
  const number = optionalCount(value.number);
  const state = oneOf(value.state, PR_STATES);
  const url = safeHref(value.url);
  if (number === undefined || number < 1 || state === undefined || url === undefined) return undefined;
  const review = oneOf(value.review, REVIEWS);
  return {
    number,
    title: text(value.title, GIT_TITLE_MAX) ?? '',
    state,
    url,
    draft: value.draft === true,
    ...(review !== undefined ? { review } : {}),
    ci: oneOf(value.ci, CI_STATES) ?? 'none',
    checks: parseChecks(value.checks),
  };
}

function parseCommit(value: unknown): GitCommit | undefined {
  if (!isRecord(value)) return undefined;
  const hash = text(value.hash, 12);
  if (hash === undefined || hash === '' || typeof value.at !== 'number' || !Number.isFinite(value.at)) return undefined;
  return { hash, subject: text(value.subject, GIT_SUBJECT_MAX) ?? '', at: Math.max(0, value.at) };
}

/** The git state of one room, or undefined when it is missing or has neither a branch nor a commit to show. */
export function parseProjectGit(value: unknown): ProjectGit | undefined {
  if (!isRecord(value)) return undefined;
  const branch = text(value.branch, GIT_BRANCH_MAX);
  const head = text(value.head, 12);
  if ((branch === undefined || branch === '') && (head === undefined || head === '')) return undefined;
  const upstream = text(value.upstream, GIT_BRANCH_MAX);
  const ahead = optionalCount(value.ahead);
  const behind = optionalCount(value.behind);
  const op: GitOperation | undefined = oneOf(value.op, GIT_OPERATIONS);
  const lastCommit = parseCommit(value.lastCommit);
  const pr = parsePullRequest(value.pr);
  return {
    ...(branch !== undefined && branch !== '' ? { branch } : {}),
    ...(head !== undefined && head !== '' ? { head } : {}),
    ...(value.detached === true ? { detached: true } : {}),
    staged: count(value.staged),
    unstaged: count(value.unstaged),
    untracked: count(value.untracked),
    conflicted: count(value.conflicted),
    insertions: count(value.insertions),
    deletions: count(value.deletions),
    ...(upstream !== undefined && upstream !== '' ? { upstream } : {}),
    ...(ahead !== undefined && behind !== undefined ? { ahead, behind } : {}),
    ...(lastCommit !== undefined ? { lastCommit } : {}),
    stash: count(value.stash),
    ...(op !== undefined ? { op } : {}),
    ...(pr !== undefined ? { pr } : {}),
  };
}

export function parseGitSettings(data: unknown): GitSettings {
  if (!isRecord(data) || typeof data.pullRequests !== 'boolean') throw new Error(t('error.invalidResponse'));
  const gh: GhStatus = oneOf(data.gh, GH_STATUSES) ?? 'unknown';
  return { pullRequests: data.pullRequests, gh };
}
