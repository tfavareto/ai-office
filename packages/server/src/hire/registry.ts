// Pending hires: a terminal was opened, the Claude Code session has not appeared yet. Each sweep looks for the session
// by project folder + account + start time and hands the placeholder over to it; hires that find nothing within the
// window are dropped (and reported).
import { type Agent, HIRE_WINDOW_MS, type PendingHire, HireBook } from '@ai-office/shared';

/** A session may be stamped a little before the request reached the registry (clock granularity, scheduling). */
export const START_SLACK_MS = 2000;

export interface NewHire {
  /** Room the placeholder goes to. */
  projectId: string;
  accountId: string;
  deskIndex?: number | undefined;
  /** Every spelling of the folder a session may report as its cwd (typed path, resolved symlinks, existing room id). */
  matchPaths: readonly string[];
}

export interface HireRegistryDeps {
  now: () => number;
  newId: () => string;
  /** The list of hires changed (a new one, a handover, an expiry). */
  onChange: () => void;
  /** A hire ran out of time without a session. */
  onExpired: (hire: PendingHire) => void;
}

function isCandidate(agent: Agent): boolean {
  return agent.kind === 'main' && agent.demo !== true && agent.status !== 'offline' && agent.status !== 'done';
}

export class HireRegistry {
  private readonly book = new HireBook();
  private readonly paths = new Map<string, ReadonlySet<string>>();

  constructor(private readonly deps: HireRegistryDeps) {}

  create(input: NewHire): PendingHire {
    const createdAt = this.deps.now();
    const hire: PendingHire = {
      id: this.deps.newId(),
      projectId: input.projectId,
      accountId: input.accountId,
      createdAt,
      expiresAt: createdAt + HIRE_WINDOW_MS,
      ...(input.deskIndex !== undefined ? { deskIndex: input.deskIndex } : {}),
    };
    this.book.add(hire);
    this.paths.set(hire.id, new Set([input.projectId, ...input.matchPaths]));
    this.deps.onChange();
    return hire;
  }

  list(now: number): PendingHire[] {
    return this.book.list(now);
  }

  /** Hands waiting hires over to the sessions that appeared for them and drops the ones that ran out of time. */
  sweep(agents: readonly Agent[], now: number): void {
    let changed = this.matchSessions(agents, now);
    for (const hire of this.book.sweep(now)) {
      this.paths.delete(hire.id);
      this.deps.onExpired(hire);
      changed = true;
    }
    for (const id of [...this.paths.keys()]) if (this.book.get(id) === undefined) this.paths.delete(id);
    if (changed) this.deps.onChange();
  }

  private matchSessions(agents: readonly Agent[], now: number): boolean {
    const waiting = this.book.unresolved(now).sort((a, b) => a.createdAt - b.createdAt);
    if (waiting.length === 0) return false;
    const taken = new Set(this.book.list(now).flatMap((hire) => (hire.agentId === undefined ? [] : [hire.agentId])));
    let changed = false;
    for (const hire of waiting) {
      const where = this.paths.get(hire.id);
      const match = agents
        .filter((agent) => isCandidate(agent) && !taken.has(agent.id) && agent.accountId === hire.accountId && where?.has(agent.projectId) === true && agent.startedAt >= hire.createdAt - START_SLACK_MS)
        .sort((a, b) => a.startedAt - b.startedAt)[0];
      if (match === undefined) continue;
      taken.add(match.id);
      changed = this.book.resolve(hire.id, match.id, now) || changed;
    }
    return changed;
  }
}
