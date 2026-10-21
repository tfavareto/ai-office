// Pending permission requests created by the plugin hook and answered from the office page.
import type {
  PermissionDecision,
  PermissionHookRequest,
  PermissionRequest,
  PermissionWaitResponse,
} from '@ai-office/shared';
import { newId } from '../util/ids';
import { describePermission, describeSuggestion, trimInput } from './permission-text';

export const PERMISSION_TTL_MS = 5 * 60_000;
export const MAX_WAIT_MS = 25_000;
/** Finished requests stay queryable this long so a late long-poll still gets the final state. */
const FINISHED_KEEP_MS = 60_000;

type Outcome = { status: 'decided'; decision: PermissionDecision } | { status: 'expired' | 'cancelled' };

interface Entry {
  request: PermissionRequest;
  outcome: Outcome | undefined;
  finishedAt: number;
  waiters: Set<(outcome: Outcome) => void>;
}

export interface PermissionDeps {
  now: () => number;
  /** Maps the hook's session (and optional raw agent id) to an office agent id. */
  resolveAgent: (sessionId: string, rawAgentId?: string) => string | undefined;
  onChange: () => void;
}

export type CreateResult = { id: string } | { skip: string };
export type DecideResult = 'ok' | 'conflict' | 'not-found';

export class PermissionRegistry {
  private readonly entries = new Map<string, Entry>();

  constructor(private readonly deps: PermissionDeps) {}

  create(request: PermissionHookRequest): CreateResult {
    const agentId = this.deps.resolveAgent(request.session_id, request.agent_id);
    if (agentId === undefined) return { skip: 'unknown-session' };
    const entry = this.entryFor(request, agentId);
    this.entries.set(entry.request.id, entry);
    this.deps.onChange();
    return { id: entry.request.id };
  }

  /**
   * Registers a request that is already answered (by an approval rule): the hook's long-poll finds the decision at
   * once, and the request never shows up as pending, so nothing in the office changes.
   */
  createDecided(request: PermissionHookRequest, agentId: string, decision: PermissionDecision): string {
    const entry = this.entryFor(request, agentId);
    entry.outcome = { status: 'decided', decision };
    entry.finishedAt = this.deps.now();
    this.entries.set(entry.request.id, entry);
    return entry.request.id;
  }

  private entryFor(request: PermissionHookRequest, agentId: string): Entry {
    const now = this.deps.now();
    const hookBudget =
      request.timeout_ms !== undefined && request.timeout_ms > 0 ? request.timeout_ms : PERMISSION_TTL_MS;
    const id = newId(8);
    const { summary, summaryMsg } = describePermission(request.tool_name, request.tool_input);
    const suggestions = (request.permission_suggestions ?? []).map(describeSuggestion);
    return {
      request: {
        id,
        agentId,
        toolName: request.tool_name,
        summary,
        ...(summaryMsg !== undefined ? { summaryMsg } : {}),
        input: trimInput(request.tool_input),
        suggestions: suggestions.map((suggestion) => suggestion.label),
        suggestionMsgs: suggestions.map((suggestion) => suggestion.msg),
        createdAt: now,
        expiresAt: now + Math.min(PERMISSION_TTL_MS, hookBudget),
      },
      outcome: undefined,
      finishedAt: 0,
      waiters: new Set(),
    };
  }

  /** Full request (with input), pending or not. */
  get(id: string): PermissionRequest | undefined {
    return this.entries.get(id)?.request;
  }

  /** The pending request of an agent, without the (potentially large) input. */
  pendingFor(agentId: string): PermissionRequest | undefined {
    for (const entry of this.entries.values()) {
      if (entry.outcome === undefined && entry.request.agentId === agentId) {
        const summary: PermissionRequest = { ...entry.request };
        delete summary.input;
        return summary;
      }
    }
    return undefined;
  }

  decide(id: string, decision: PermissionDecision): DecideResult {
    const entry = this.entries.get(id);
    if (entry === undefined) return 'not-found';
    if (entry.outcome !== undefined) return 'conflict';
    this.finish(entry, { status: 'decided', decision });
    return 'ok';
  }

  /** Cancels the pending request of an agent (the session moved on: it was answered in the terminal). */
  cancelFor(agentId: string): void {
    for (const entry of this.entries.values()) {
      if (entry.outcome === undefined && entry.request.agentId === agentId) this.finish(entry, { status: 'cancelled' });
    }
  }

  /** Long-poll: resolves when decided/expired/cancelled, or `pending` after the timeout. */
  wait(id: string, timeoutMs: number, signal?: AbortSignal): Promise<PermissionWaitResponse> {
    const entry = this.entries.get(id);
    if (entry === undefined) return Promise.resolve({ status: 'cancelled' });
    if (entry.outcome !== undefined) return Promise.resolve(toResponse(entry.outcome));
    const limit = Math.min(Math.max(timeoutMs, 0), MAX_WAIT_MS);
    return new Promise((resolve) => {
      const done = (outcome: Outcome | undefined): void => {
        clearTimeout(timer);
        entry.waiters.delete(listener);
        signal?.removeEventListener('abort', onAbort);
        resolve(outcome === undefined ? { status: 'pending' } : toResponse(outcome));
      };
      const listener = (outcome: Outcome): void => done(outcome);
      const onAbort = (): void => done(undefined);
      const timer = setTimeout(() => done(undefined), limit);
      entry.waiters.add(listener);
      signal?.addEventListener('abort', onAbort, { once: true });
    });
  }

  /** Expires old requests and forgets finished ones. */
  sweep(): void {
    const now = this.deps.now();
    for (const [id, entry] of this.entries) {
      if (entry.outcome === undefined && now >= entry.request.expiresAt) this.finish(entry, { status: 'expired' });
      else if (entry.outcome !== undefined && now - entry.finishedAt > FINISHED_KEEP_MS) this.entries.delete(id);
    }
  }

  private finish(entry: Entry, outcome: Outcome): void {
    entry.outcome = outcome;
    entry.finishedAt = this.deps.now();
    for (const waiter of [...entry.waiters]) waiter(outcome);
    this.deps.onChange();
  }
}

function toResponse(outcome: Outcome): PermissionWaitResponse {
  return outcome.status === 'decided' ? { status: 'decided', ...outcome.decision } : { status: outcome.status };
}
