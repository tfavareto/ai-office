// Where a canvas terminal reads its conversation from: the local server (incremental, from the cursor of the last
// page), or — for the agents of the demo and of `?mock=1`, which have no transcript file — the activities the page has
// seen them do, written as a CLI session with plausible tool output.
import type { Agent, OfficeSnapshot, TranscriptEntry, TranscriptPage } from '@ai-office/shared';
import { MockLog } from '../../net/mock-data';
import type { AppContext } from '../../ui/context';
import { activityEntries, headPrompt } from '../model/activity-entries';
import { demoResult } from '../model/demo-results';
import type { FeedSource } from './transcript-feed';

/** The page of a demo conversation: like the server, `next` stays on a call still waiting for its result. */
export function demoPage(entries: readonly TranscriptEntry[], after: number, open: boolean): TranscriptPage {
  const pending = entries.findIndex((entry) => entry.kind === 'tool' && entry.result === undefined);
  return {
    entries: entries.slice(Math.max(0, after)),
    next: pending >= 0 ? pending : entries.length,
    open,
  };
}

/** Conversations of demo agents, built from the activities seen in the snapshots. */
export class DemoTranscripts {
  private readonly log = new MockLog();
  private lastRev = -1;

  /** Feeds the log with a snapshot (once per revision). */
  observe(snapshot: OfficeSnapshot): void {
    if (snapshot.rev === this.lastRev) return;
    this.lastRev = snapshot.rev;
    this.log.observe(snapshot);
  }

  page(agent: Agent, after: number | undefined): TranscriptPage {
    const activities = this.log.activities(agent.id);
    const head = headPrompt(agent, activities[0]);
    const entries = [
      ...(head === undefined ? [] : [head]),
      ...activityEntries(activities, { pendingLast: agent.status === 'working', result: demoResult }),
    ];
    return demoPage(entries, after ?? 0, agent.status !== 'done' && agent.status !== 'offline');
  }
}

/** The feed source for an agent. `current` returns the freshest known copy of it (a finished subagent is no longer in the snapshot). */
export function feedSourceFor(ctx: AppContext, demo: DemoTranscripts, current: () => Agent): FeedSource {
  return {
    page: async (after) => {
      const agent = current();
      if (agent.demo === true) return demo.page(agent, after);
      return ctx.store.backend.transcript({
        sessionId: agent.sessionId,
        accountId: agent.accountId,
        agentId: agent.kind === 'sub' ? agent.id : undefined,
        after,
      });
    },
  };
}
