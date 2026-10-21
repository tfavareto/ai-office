// Bulk triage of permission requests: which ones can be decided together, and what a bulk action will do.
import type { InboxItem } from './inbox';
import { similarityLabel } from './permission-pattern';

export type BulkAction = 'approve' | 'deny';
export type SkipReason = 'risky' | 'expired' | 'not-permission';

export interface BulkSkip {
  item: InboxItem;
  reason: SkipReason;
}

/** What a bulk action will do: the items it decides and the ones it leaves alone (with the reason). */
export interface BulkPlan {
  action: BulkAction;
  include: InboxItem[];
  skipped: BulkSkip[];
}

export interface SimilarGroup {
  key: string;
  toolName: string;
  /** What the requests have in common ("npm test", "src/*.ts"). */
  label: string;
  items: InboxItem[];
}

/** Minimum number of requests that makes a group worth offering. */
export const MIN_GROUP_SIZE = 2;

function skipReason(action: BulkAction, item: InboxItem): SkipReason | null {
  if (item.kind !== 'permission' || item.permission === undefined) return 'not-permission';
  if (item.expired === true) return 'expired';
  // Denying a risky request is always fine; approving one in bulk is not.
  if (action === 'approve' && item.risk !== undefined) return 'risky';
  return null;
}

export function planBulk(action: BulkAction, items: readonly InboxItem[]): BulkPlan {
  const include: InboxItem[] = [];
  const skipped: BulkSkip[] = [];
  for (const item of items) {
    const reason = skipReason(action, item);
    if (reason === null) include.push(item);
    else skipped.push({ item, reason });
  }
  return { action, include, skipped };
}

/** Groups of two or more identical-looking requests that are safe to approve together (never risky ones). */
export function similarGroups(items: readonly InboxItem[]): SimilarGroup[] {
  const groups = new Map<string, SimilarGroup>();
  for (const item of items) {
    if (skipReason('approve', item) !== null || item.permission === undefined || item.similarKey === undefined)
      continue;
    const group = groups.get(item.similarKey);
    if (group) group.items.push(item);
    else
      groups.set(item.similarKey, {
        key: item.similarKey,
        toolName: item.permission.toolName,
        label: similarityLabel(item.permission),
        items: [item],
      });
  }
  return Array.from(groups.values())
    .filter((group) => group.items.length >= MIN_GROUP_SIZE)
    .sort((a, b) => b.items.length - a.items.length || a.key.localeCompare(b.key));
}

/** The group an item belongs to, if any. */
export function groupOf(groups: readonly SimilarGroup[], itemId: string): SimilarGroup | undefined {
  return groups.find((group) => group.items.some((item) => item.id === itemId));
}
