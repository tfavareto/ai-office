// A terminal that cannot read its conversation (off the live slots, zoomed out, a demo agent) still shows terminal text:
// the activities the office already knows, written as the entries of a transcript. A tool activity becomes a tool
// call, an error is attached to the call it belongs to (a red result under it, as the CLI prints it), the newest call
// of a working agent has no result yet. Pure, apart from the cache that keeps entries the same objects between
// snapshots so the renderer only touches what changed.
import type { Activity, ActivityKind, Agent, TranscriptEntry } from '@ai-office/shared';
import { tm } from '../../i18n';
import { activityDetail, activityText, agentTitle } from '../../ui/display';

const TOOL_NAMES: Partial<Record<ActivityKind, string>> = {
  read: 'Read',
  search: 'Grep',
  edit: 'Edit',
  write: 'Write',
  bash: 'Bash',
  web: 'WebFetch',
  task: 'TodoWrite',
  subagent: 'Task',
  mcp: 'MCP',
  question: 'AskUserQuestion',
};

type ToolEntry = Extract<TranscriptEntry, { kind: 'tool' }>;

export interface ActivityEntryOptions {
  /** The agent is working: its newest tool call is still running (no result yet). */
  pendingLast: boolean;
  /** The result written under a finished call ('' writes none). */
  result(activity: Activity): string;
}

/** Results of real sessions are not in the activities: only an error has text to show. */
export const NO_RESULT = (): string => '';

/** What a delegation was about: the description inside its message ("Delegating: <description>"). */
function delegated(activity: Activity): string | undefined {
  const value = activity.msg?.params?.description;
  if (typeof value === 'string') return value;
  return typeof value === 'object' ? tm(value, '') : undefined;
}

function toolEntry(activity: Activity, name: string, result: string | undefined): ToolEntry {
  const description = activity.kind === 'subagent' ? delegated(activity) : undefined;
  const detail = description ?? activityDetail(activity);
  return {
    kind: 'tool',
    at: activity.at,
    id: activity.id,
    name,
    summary: `${activity.icon} ${activity.text}`,
    icon: activity.icon,
    ...(activity.msg !== undefined ? { summaryMsg: activity.msg } : {}),
    ...(detail !== undefined && name !== 'MCP' ? { input: { detail } } : {}),
    ...(result !== undefined ? { result } : {}),
  };
}

function plainEntry(activity: Activity): TranscriptEntry {
  const text = activityDetail(activity) ?? activityText(activity);
  switch (activity.kind) {
    case 'prompt':
    case 'message':
      return { kind: 'user', at: activity.at, text };
    case 'think':
      return { kind: 'thinking', at: activity.at, text: activityDetail(activity) ?? '' };
    case 'reply':
      return { kind: 'assistant', at: activity.at, text };
    default:
      return {
        kind: 'system',
        at: activity.at,
        text: activity.text,
        ...(activity.msg !== undefined ? { msg: activity.msg } : {}),
      };
  }
}

/** The entries of a list of activities (oldest first). */
export function activityEntries(activities: readonly Activity[], options: ActivityEntryOptions): TranscriptEntry[] {
  const entries: TranscriptEntry[] = [];
  let lastTool = -1;
  activities.forEach((activity, index) => {
    if (activity.kind === 'error') {
      const errorText = activityDetail(activity) ?? activityText(activity);
      const target = lastTool >= 0 ? entries[lastTool] : undefined;
      if (target?.kind === 'tool') {
        entries[lastTool] = { ...target, result: errorText, error: true };
        lastTool = -1;
      } else
        entries.push({
          kind: 'tool',
          at: activity.at,
          id: activity.id,
          name: 'Error',
          summary: errorText,
          result: errorText,
          error: true,
        });
      return;
    }
    const name = TOOL_NAMES[activity.kind];
    if (name === undefined) {
      entries.push(plainEntry(activity));
      return;
    }
    const pending = options.pendingLast && index === activities.length - 1;
    lastTool = entries.length;
    entries.push(toolEntry(activity, name, pending ? undefined : options.result(activity)));
  });
  return entries;
}

/** The subagent's task (or the session title) as the first prompt, when the activities do not start with one. */
export function headPrompt(
  agent: Pick<Agent, 'title' | 'titleMsg' | 'startedAt'>,
  first: Activity | undefined,
): TranscriptEntry | undefined {
  if (first?.kind === 'prompt') return undefined;
  const title = agentTitle(agent);
  return title === undefined || title.trim() === '' ? undefined : { kind: 'user', at: agent.startedAt, text: title };
}

function sameEntry(a: TranscriptEntry, b: TranscriptEntry): boolean {
  if (a.kind !== b.kind || a.at !== b.at) return false;
  if (a.kind === 'tool' && b.kind === 'tool') return a.id === b.id && a.result === b.result && a.error === b.error;
  return 'text' in a && 'text' in b && a.text === b.text;
}

/**
 * Keeps the entries built from activities the same objects while they do not change, so the DOM diff (by identity)
 * only renders the new lines.
 */
export class ActivityEntryCache {
  private previous: readonly TranscriptEntry[] = [];

  entries(
    agent: Pick<Agent, 'title' | 'titleMsg' | 'startedAt'>,
    activities: readonly Activity[],
    options: ActivityEntryOptions,
  ): readonly TranscriptEntry[] {
    const head = headPrompt(agent, activities[0]);
    const fresh = [...(head === undefined ? [] : [head]), ...activityEntries(activities, options)];
    const pool = this.previous;
    let changed = fresh.length !== pool.length;
    const merged = fresh.map((entry) => {
      const old = pool.find((candidate) => sameEntry(candidate, entry));
      if (old === undefined) {
        changed = true;
        return entry;
      }
      return old;
    });
    if (!changed && merged.every((entry, index) => entry === pool[index])) return pool;
    this.previous = merged;
    return merged;
  }
}
