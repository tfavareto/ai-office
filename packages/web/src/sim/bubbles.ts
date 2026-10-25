import type { Activity, ActivityKind, Msg } from '@ai-office/shared';

export type BubbleMode = 'all' | 'important' | 'none';
export type Liveliness = 'calm' | 'normal' | 'lively';

export interface BubbleCandidate {
  agentId: string;
  /** Area the agent is in (the per-room cap uses it). */
  roomId: string;
  /** pt-BR text (already clipped): shown when the bubble has no `msg` or the viewer's language has no entry for it. */
  text: string;
  /** Localizable form of `text`: the activity's `msg` from the server/demo, or a world catalog message. */
  msg?: Msg;
  icon: string;
  importance: number;
  /** Stays until replaced or withdrawn (alerts). */
  sticky: boolean;
  /** Seconds on screen for non-sticky bubbles. */
  ttl: number;
  /** Shown with the happy look (a celebration). */
  tone?: 'good';
  /** Small talk between people (icons only): shown unless bubbles are off, and never in calm mode. */
  ambient?: boolean;
}

/** A bubble as the simulation offers it for a person (the manager adds who and where). */
export type BubbleSpec = Omit<BubbleCandidate, 'agentId' | 'roomId'>;

export interface Bubble extends BubbleCandidate {
  /** Sim time (s) when the bubble became visible; fades are computed from it. */
  shownAt: number;
  /** Sim time (s) after which it disappears (Infinity when sticky). */
  endsAt: number;
}

const IMPORTANCE: Record<ActivityKind, number> = {
  permission: 90,
  question: 90,
  error: 70,
  done: 60,
  message: 55,
  subagent: 40,
  task: 35,
  edit: 30,
  write: 30,
  bash: 28,
  web: 25,
  mcp: 22,
  reply: 20,
  prompt: 20,
  search: 18,
  read: 15,
  think: 12,
  other: 10,
};

export const IMPORTANT_THRESHOLD = 55;
export const ALERT_IMPORTANCE = 100;
const GLOBAL_CAP = 8;
const ROOM_CAP: Record<Liveliness, number> = { calm: 1, normal: 2, lively: 3 };
/** Minimum seconds between two bubbles of the same agent. */
const AGENT_COOLDOWN = 2.2;
const MAX_TEXT = 34;

export function activityImportance(activity: Activity): number {
  return activity.error ? Math.max(70, IMPORTANCE[activity.kind]) : IMPORTANCE[activity.kind];
}

export function clipText(text: string, max = MAX_TEXT): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length <= max ? flat : `${flat.slice(0, max - 1).trimEnd()}…`;
}

/** The text a bubble shows in the language of `translate` (`tm` of a world translator): `msg` rendered, clipped to the bubble size. */
export function bubbleText(
  bubble: Pick<BubbleCandidate, 'text' | 'msg'>,
  translate: (msg: Msg | undefined, fallback: string) => string,
): string {
  return bubble.msg ? clipText(translate(bubble.msg, bubble.text)) : bubble.text;
}

/**
 * Speech-bubble queue with rationing: a bubble per agent at most, a cap per room and a cap overall; higher importance
 * wins, then recency. Pure and deterministic (driven only by the times it is given).
 */
export class BubbleManager {
  private pending = new Map<string, BubbleCandidate & { offeredAt: number }>();
  private visible = new Map<string, Bubble>();
  private lastShown = new Map<string, number>();
  private mode: BubbleMode = 'important';
  private liveliness: Liveliness = 'normal';

  configure(mode: BubbleMode, liveliness: Liveliness): void {
    this.mode = mode;
    this.liveliness = liveliness;
  }

  /** Offer a bubble for an agent; it replaces that agent's pending/visible bubble when at least as important. */
  offer(candidate: BubbleCandidate, now: number): void {
    if (!this.allows(candidate)) return;
    const current = this.visible.get(candidate.agentId);
    if (current && current.sticky && current.importance > candidate.importance) return;
    this.pending.set(candidate.agentId, { ...candidate, offeredAt: now });
  }

  /** Remove everything of an agent (it left, or its alert was answered). */
  withdraw(agentId: string): void {
    this.pending.delete(agentId);
    this.visible.delete(agentId);
  }

  /** Remove only a sticky bubble (alert answered) keeping normal ones. */
  withdrawSticky(agentId: string): void {
    this.pending.delete(agentId);
    const current = this.visible.get(agentId);
    if (current?.sticky) this.visible.delete(agentId);
  }

  update(now: number, roomOf: (agentId: string) => string | null): readonly Bubble[] {
    for (const [agentId, bubble] of this.visible) {
      if (now >= bubble.endsAt || roomOf(agentId) === null) this.visible.delete(agentId);
      else {
        const room = roomOf(agentId);
        if (room && room !== bubble.roomId) this.visible.set(agentId, { ...bubble, roomId: room });
      }
    }
    if (this.mode === 'none') {
      this.visible.clear();
      this.pending.clear();
      return [];
    }

    const ready = [...this.pending.values()]
      .filter((c) => {
        const last = this.lastShown.get(c.agentId) ?? -Infinity;
        const showing = this.visible.get(c.agentId);
        const blocked =
          showing && !showing.sticky && showing.importance >= c.importance && now - showing.shownAt < showing.ttl * 0.5;
        return roomOf(c.agentId) !== null && !blocked && (c.sticky || now - last >= AGENT_COOLDOWN);
      })
      .sort((a, b) => b.importance - a.importance || b.offeredAt - a.offeredAt);

    for (const candidate of ready) {
      const roomId = roomOf(candidate.agentId) ?? candidate.roomId;
      const replacing = this.visible.has(candidate.agentId);
      if (!candidate.sticky && !replacing) {
        if (this.visible.size >= GLOBAL_CAP) continue;
        if (this.countInRoom(roomId) >= ROOM_CAP[this.liveliness]) continue;
      }
      this.visible.set(candidate.agentId, {
        ...candidate,
        roomId,
        shownAt: now,
        endsAt: candidate.sticky ? Infinity : now + candidate.ttl,
      });
      this.lastShown.set(candidate.agentId, now);
      this.pending.delete(candidate.agentId);
    }

    // anything still waiting is stale after a while: drop it so old news never shows
    for (const [agentId, c] of this.pending) {
      if (!c.sticky && now - c.offeredAt > 6) this.pending.delete(agentId);
    }
    return [...this.visible.values()];
  }

  current(): readonly Bubble[] {
    return [...this.visible.values()];
  }

  private countInRoom(roomId: string): number {
    let n = 0;
    for (const b of this.visible.values()) if (b.roomId === roomId && !b.sticky) n++;
    return n;
  }

  private allows(c: BubbleCandidate): boolean {
    if (this.mode === 'none') return false;
    if (c.ambient) return this.liveliness !== 'calm';
    if (this.mode === 'important') return c.importance >= IMPORTANT_THRESHOLD;
    return true;
  }
}
