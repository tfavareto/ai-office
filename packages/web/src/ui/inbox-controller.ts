// State of the "needs you" inbox: what is listed (derived), what the user selected, where the cursor is and what
// they have seen. The seen marks persist in this browser only (localStorage), nothing is sent anywhere.
import type { OfficeSnapshot } from '@ai-office/shared';
import { buildInbox, EMPTY_INBOX_VIEW, finishedIdsOf, type InboxView } from './model/inbox';
import { similarGroups, type BulkPlan, type SimilarGroup } from './model/inbox-bulk';
import {
  EMPTY_SELECTION,
  moveCursor,
  pruneSelection,
  selectAll,
  selectRange,
  settleCursor,
  toggleSelected,
  type InboxSelection,
} from './model/inbox-selection';
import { INBOX_STORAGE_KEY, markSeen, parseInboxStateJson, pruneSeen, serializeInboxState, withBaseline, type InboxState } from './model/inbox-state';
import type { NotificationItem } from './model/notifications';
import { Observable } from './observable';

export interface InboxUiData {
  state: InboxState;
  selection: InboxSelection;
  cursor: string | null;
  /** Row whose "deny with a reason" box is open. */
  denying: string | null;
  /** Bulk action waiting for the user's confirmation. */
  confirm: BulkPlan | null;
  /** Items whose answer is being sent. */
  busy: readonly string[];
}

export interface InboxDeps {
  snapshot(): OfficeSnapshot | null;
  notifications(): readonly NotificationItem[];
  now(): number;
  storage?: InboxStorage | null;
}

type InboxStorage = Pick<Storage, 'getItem' | 'setItem'>;

function resolveStorage(deps: InboxDeps): InboxStorage | null {
  if (deps.storage !== undefined) return deps.storage;
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

function loadState(storage: InboxStorage | null): InboxState {
  try {
    return parseInboxStateJson(storage?.getItem(INBOX_STORAGE_KEY) ?? null);
  } catch {
    return parseInboxStateJson(null);
  }
}

export class InboxController extends Observable<InboxUiData> {
  private readonly storage: InboxStorage | null;
  private cached: { key: readonly unknown[]; view: InboxView } | null = null;
  private groupsCache: { view: InboxView; groups: SimilarGroup[] } | null = null;
  private lastIds: readonly string[] = [];

  constructor(private readonly deps: InboxDeps) {
    super({ state: loadState(resolveStorage(deps)), selection: EMPTY_SELECTION, cursor: null, denying: null, confirm: null, busy: [] });
    this.storage = resolveStorage(deps);
  }

  /** The items to show now. Cheap to call on every render pass: it only recomputes when its inputs change. */
  view(): InboxView {
    const snapshot = this.deps.snapshot();
    if (!snapshot) return EMPTY_INBOX_VIEW;
    const notifications = this.deps.notifications();
    const now = this.deps.now();
    const key = [snapshot, notifications, this.value.state, Math.floor(now / 1000)];
    if (this.cached && this.cached.key.every((part, index) => Object.is(part, key[index]))) return this.cached.view;
    const view = buildInbox({ snapshot, notifications, state: this.value.state, now });
    this.cached = { key, view };
    return view;
  }

  /** Groups of identical-looking requests that are safe to approve together. */
  groups(): SimilarGroup[] {
    const view = this.view();
    if (this.groupsCache?.view !== view) this.groupsCache = { view, groups: similarGroups(view.items) };
    return this.groupsCache.groups;
  }

  /** A new snapshot arrived: set the baseline, forget what vanished and keep the cursor where it was. */
  sync(snapshot: OfficeSnapshot): void {
    const state = pruneSeen(withBaseline(this.value.state, snapshot.serverTime), this.deps.now());
    if (state !== this.value.state) this.update({ state });
    const ids = this.view().items.map((item) => item.id);
    const cursor = settleCursor(this.lastIds, ids, this.value.cursor);
    this.lastIds = ids;
    const selection = pruneSelection(this.value.selection, ids);
    const confirm = this.value.confirm && this.value.confirm.include.every((item) => ids.includes(item.id)) ? this.value.confirm : null;
    const denying = this.value.denying !== null && ids.includes(this.value.denying) ? this.value.denying : null;
    const stillBusy = this.value.busy.filter((id) => ids.includes(id));
    const busy = stillBusy.length === this.value.busy.length ? this.value.busy : stillBusy;
    this.set({ cursor, selection, confirm, denying, busy });
  }

  set(patch: Partial<InboxUiData>): void {
    const keys = Object.keys(patch) as (keyof InboxUiData)[];
    if (keys.every((key) => Object.is(patch[key], this.value[key]))) return;
    this.update(patch);
  }

  private update(patch: Partial<InboxUiData>): void {
    const next = { ...this.value, ...patch };
    if (next.state !== this.value.state) this.persist(next.state);
    this.replace(next);
  }

  private persist(state: InboxState): void {
    try {
      this.storage?.setItem(INBOX_STORAGE_KEY, serializeInboxState(state));
    } catch {
      // Storage unavailable or full: the marks last until the page closes.
    }
  }

  private orderedIds(): string[] {
    return this.view().items.map((item) => item.id);
  }

  // --- selection and cursor -----------------------------------------------------------------------------------------

  toggleSelected(id: string): void {
    this.set({ selection: toggleSelected(this.value.selection, id), cursor: id });
  }

  selectRangeTo(id: string): void {
    this.set({ selection: selectRange(this.value.selection, this.orderedIds(), id), cursor: id });
  }

  selectAll(): void {
    this.set({ selection: selectAll(this.orderedIds()) });
  }

  clearSelection(): void {
    this.set({ selection: EMPTY_SELECTION });
  }

  setCursor(id: string | null): void {
    this.set({ cursor: id });
  }

  moveCursor(delta: number): string | null {
    const cursor = moveCursor(this.orderedIds(), this.value.cursor, delta);
    this.set({ cursor });
    return cursor;
  }

  // --- seen ---------------------------------------------------------------------------------------------------------

  markSeen(ids: readonly string[]): void {
    this.update({ state: markSeen(this.value.state, ids, this.deps.now()) });
  }

  /** Looking at an agent counts as having seen that its work finished. */
  markAgentSeen(agentId: string): void {
    const ids = finishedIdsOf(this.view().items, agentId);
    if (ids.length > 0) this.markSeen(ids);
  }

  // --- pending work -------------------------------------------------------------------------------------------------

  setBusy(ids: readonly string[], on: boolean): void {
    const rest = this.value.busy.filter((id) => !ids.includes(id));
    this.set({ busy: on ? [...rest, ...ids] : rest });
  }
}
