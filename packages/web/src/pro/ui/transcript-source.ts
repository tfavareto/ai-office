// Where a canvas terminal reads its conversation from: the local server, or — for the agents of the demo and of
// `?mock=1`, which have no transcript file — the activities the page has seen them do.
import type { Agent, OfficeSnapshot, TranscriptPage } from '@ai-office/shared';
import { MockLog } from '../../net/mock-data';
import type { AppContext } from '../../ui/context';
import type { FeedSource } from './transcript-feed';

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
    return this.log.transcript(agent, after ?? 0);
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
