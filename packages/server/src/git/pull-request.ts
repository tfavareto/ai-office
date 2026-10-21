// Pull request of the current branch through the user's own `gh` CLI. This is the only part of the git integration that
// uses the network, and only when the person turned it on. `gh` is started with an argument array and a time limit.
import {
  ciOfChecks,
  GIT_FAILING_MAX,
  GIT_TITLE_MAX,
  type GhStatus,
  type GitChecks,
  type GitPullRequest,
  type PullRequestState,
  type ReviewDecision,
} from '@ai-office/shared';
import { asArray, asNumber, asRecord, asString } from '../util/fs-safe';
import { GH_TIMEOUT_MS, RunError, type Runner } from './run';

export const PR_FIELDS = 'number,title,state,url,isDraft,reviewDecision,statusCheckRollup';
const MAX_URL = 500;
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f]/g;

const FAILED_CONCLUSIONS = new Set([
  'FAILURE',
  'TIMED_OUT',
  'CANCELLED',
  'ACTION_REQUIRED',
  'STARTUP_FAILURE',
  'ERROR',
]);
const PASSED_CONCLUSIONS = new Set(['SUCCESS', 'NEUTRAL', 'SKIPPED']);
const FAILED_STATES = new Set(['FAILURE', 'ERROR']);
const PENDING_STATES = new Set(['PENDING', 'EXPECTED']);
const STATES: Readonly<Record<string, PullRequestState>> = { OPEN: 'open', MERGED: 'merged', CLOSED: 'closed' };
const REVIEWS: Readonly<Record<string, ReviewDecision>> = {
  APPROVED: 'approved',
  CHANGES_REQUESTED: 'changes-requested',
  REVIEW_REQUIRED: 'review-required',
};

type CheckOutcome = 'passed' | 'failed' | 'pending';

/** One entry of `statusCheckRollup`: a check run (status + conclusion) or a commit status (state). */
function outcomeOf(entry: Record<string, unknown>): CheckOutcome | undefined {
  const conclusion = asString(entry.conclusion)?.toUpperCase();
  const status = asString(entry.status)?.toUpperCase();
  const state = asString(entry.state)?.toUpperCase();
  if (conclusion === undefined && status === undefined && state === undefined) return undefined;
  if (state !== undefined) {
    if (FAILED_STATES.has(state)) return 'failed';
    if (PENDING_STATES.has(state)) return 'pending';
    return state === 'SUCCESS' ? 'passed' : undefined;
  }
  if (status !== undefined && status !== 'COMPLETED') return 'pending';
  if (conclusion === undefined || conclusion === '') return status === 'COMPLETED' ? undefined : 'pending';
  if (FAILED_CONCLUSIONS.has(conclusion)) return 'failed';
  return PASSED_CONCLUSIONS.has(conclusion) ? 'passed' : undefined;
}

function nameOf(entry: Record<string, unknown>): string {
  return (asString(entry.name) ?? asString(entry.context) ?? '').replace(CONTROL, ' ').trim().slice(0, 80);
}

export function summarizeChecks(rollup: unknown): GitChecks {
  const checks: GitChecks = { total: 0, passed: 0, failed: 0, pending: 0 };
  const failing: string[] = [];
  for (const raw of asArray(rollup)) {
    const entry = asRecord(raw);
    const outcome = outcomeOf(entry);
    if (outcome === undefined) continue;
    checks.total++;
    checks[outcome]++;
    const name = nameOf(entry);
    if (outcome === 'failed' && name.length > 0 && failing.length < GIT_FAILING_MAX) failing.push(name);
  }
  return failing.length > 0 ? { ...checks, failing } : checks;
}

function safeUrl(value: string | undefined): string | undefined {
  if (value === undefined || value.length > MAX_URL) return undefined;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : undefined;
  } catch {
    return undefined;
  }
}

/** Parses the JSON of `gh pr view --json ...`; undefined when it is not a pull request we can show. */
export function parsePullRequest(output: string): GitPullRequest | undefined {
  let data: unknown;
  try {
    data = JSON.parse(output) as unknown;
  } catch {
    return undefined;
  }
  const raw = asRecord(data);
  const number = asNumber(raw.number);
  const state = STATES[asString(raw.state)?.toUpperCase() ?? ''];
  const url = safeUrl(asString(raw.url));
  if (number === undefined || !Number.isInteger(number) || number < 1 || state === undefined || url === undefined)
    return undefined;
  const checks = summarizeChecks(raw.statusCheckRollup);
  const review = REVIEWS[asString(raw.reviewDecision)?.toUpperCase() ?? ''];
  return {
    number,
    title: (asString(raw.title) ?? '').replace(CONTROL, ' ').trim().slice(0, GIT_TITLE_MAX),
    state,
    url,
    draft: raw.isDraft === true,
    ...(review !== undefined ? { review } : {}),
    ci: ciOfChecks(checks),
    checks,
  };
}

export type PullRequestLookup =
  | { status: 'found'; pr: GitPullRequest }
  | { status: 'none' }
  | { status: 'unavailable'; gh: GhStatus }
  | { status: 'error' };

const NO_PR = /no pull requests? found/i;
const NOT_LOGGED_IN = /gh auth login|not logged in|authentication|GH_TOKEN|HTTP 401/i;

/** Asks `gh` for the pull request of the branch checked out in `projectPath`. Never throws. */
export async function lookupPullRequest(run: Runner, projectPath: string): Promise<PullRequestLookup> {
  try {
    const output = await run('gh', ['pr', 'view', '--json', PR_FIELDS], { cwd: projectPath, timeoutMs: GH_TIMEOUT_MS });
    const pr = parsePullRequest(output);
    return pr === undefined ? { status: 'error' } : { status: 'found', pr };
  } catch (error) {
    if (!(error instanceof RunError)) return { status: 'error' };
    if (error.notFound) return { status: 'unavailable', gh: 'missing' };
    if (NO_PR.test(error.stderr)) return { status: 'none' };
    if (NOT_LOGGED_IN.test(error.stderr)) return { status: 'unavailable', gh: 'unauthenticated' };
    return { status: 'error' };
  }
}
