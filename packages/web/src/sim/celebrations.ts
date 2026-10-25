// Rationing of celebrations: a trigger becomes a party only when the person, the room and the office as a whole have
// not had one too recently. Pure and deterministic: it only sees the times it is given.
import type { Liveliness } from './bubbles';
import type { Trigger, TriggerKind } from './triggers';

export interface Grant {
  agentId: string;
  projectId: string;
  kind: TriggerKind;
  /** A room-wide milestone: confetti shower over the whole room. */
  shower: boolean;
}

/** Higher wins over the cooldown of a lesser celebration of the same person. */
const PRIORITY: Record<TriggerKind, number> = {
  commit: 1,
  'tests-fixed': 2,
  'subagent-done': 2,
  'tasks-done': 3,
  'streak-end': 3,
  'pr-merged': 4,
};

/** Seconds a person waits between two celebrations, per animation level. */
const AGENT_COOLDOWN: Record<Liveliness, number> = { calm: 60, normal: 30, lively: 14 };
/** Seconds between two celebrations anywhere in the office. */
const GLOBAL_GAP: Record<Liveliness, number> = { calm: 3, normal: 1.6, lively: 0.9 };
/** The same trigger of the same person is one event, however many times it is reported. */
const SAME_KIND_GAP = 20;
const ROOM_SHOWER_COOLDOWN = 90;
const WINDOW_SECONDS = 12;
const WINDOW_MAX: Record<Liveliness, number> = { calm: 2, normal: 4, lively: 6 };

interface Last {
  at: number;
  priority: number;
}

export class CelebrationBook {
  private liveliness: Liveliness = 'normal';
  private readonly byAgent = new Map<string, Last>();
  private readonly byAgentKind = new Map<string, number>();
  private readonly showers = new Map<string, number>();
  private recent: number[] = [];

  configure(liveliness: Liveliness): void {
    this.liveliness = liveliness;
  }

  reset(): void {
    this.byAgent.clear();
    this.byAgentKind.clear();
    this.showers.clear();
    this.recent = [];
  }

  /** Decides on a trigger. `roomDone` says that this very event completed every task of the room. */
  request(trigger: Trigger, now: number, roomDone: boolean): Grant | null {
    const priority = PRIORITY[trigger.kind];
    const kindKey = `${trigger.agentId}|${trigger.kind}`;
    const lastKind = this.byAgentKind.get(kindKey);
    if (lastKind !== undefined && now - lastKind < SAME_KIND_GAP) return null;

    this.recent = this.recent.filter((t) => now - t < WINDOW_SECONDS);
    const lastAny = this.recent[this.recent.length - 1];
    if (lastAny !== undefined && now - lastAny < GLOBAL_GAP[this.liveliness]) return null;
    if (this.recent.length >= WINDOW_MAX[this.liveliness]) return null;

    const last = this.byAgent.get(trigger.agentId);
    if (last !== undefined && now - last.at < AGENT_COOLDOWN[this.liveliness] && priority <= last.priority) return null;

    const showerAt = this.showers.get(trigger.projectId);
    const shower = roomDone && (showerAt === undefined || now - showerAt >= ROOM_SHOWER_COOLDOWN);
    if (shower) this.showers.set(trigger.projectId, now);

    this.byAgent.set(trigger.agentId, { at: now, priority });
    this.byAgentKind.set(kindKey, now);
    this.recent.push(now);
    return { agentId: trigger.agentId, projectId: trigger.projectId, kind: trigger.kind, shower };
  }
}

/** Confetti particles scale with the animation level. */
export const CONFETTI_SCALE: Record<Liveliness, number> = { calm: 0.6, normal: 1, lively: 1.4 };
