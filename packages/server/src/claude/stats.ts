// Per-transcript statistics accumulator: token usage deduplicated by message id, cost estimate, line counts.
import type { AgentStats } from '@ai-office/shared';
import { mergeUsage, tokensIn, usageCostUSD } from './cost';
import type { UsageInfo } from './types';

const MAX_TRACKED_MESSAGES = 4000;

interface Entry {
  usage: UsageInfo;
  model: string | undefined;
}

export class StatsAccumulator {
  private readonly messages = new Map<string, Entry>();
  private toolCalls = 0;
  private linesAdded = 0;
  private linesRemoved = 0;
  private baseline: { costUSD: number; linesAdded: number; linesRemoved: number } | undefined;
  private tokensInTotal = 0;
  private tokensOutTotal = 0;
  private costTotal = 0;
  private hasCost = false;

  countToolCall(): void {
    this.toolCalls++;
  }

  addLines(added: number, removed: number): void {
    this.linesAdded += added;
    this.linesRemoved += removed;
  }

  /** A `cost-state` line carries session totals: use them as the new baseline and restart the local sums. */
  setBaseline(costUSD: number, linesAdded: number, linesRemoved: number): void {
    this.baseline = { costUSD, linesAdded, linesRemoved };
    this.linesAdded = 0;
    this.linesRemoved = 0;
    this.costTotal = 0;
    this.hasCost = false;
    for (const entry of this.messages.values()) entry.model = undefined;
  }

  /**
   * Registers the usage of a message. Repeated lines of the same message keep the field-wise maximum.
   * Returns the usage that should be counted globally (the merged record).
   */
  addUsage(messageId: string | undefined, model: string | undefined, usage: UsageInfo): UsageInfo {
    const key = messageId ?? `anon-${this.messages.size}-${usage.output}`;
    const previous = this.messages.get(key);
    const merged = previous === undefined ? usage : mergeUsage(previous.usage, usage);
    if (previous !== undefined) this.remove(previous);
    const entry: Entry = { usage: merged, model };
    this.messages.set(key, entry);
    this.add(entry);
    if (this.messages.size > MAX_TRACKED_MESSAGES) {
      const oldest = this.messages.keys().next().value;
      if (oldest !== undefined) this.messages.delete(oldest);
    }
    return merged;
  }

  private add(entry: Entry): void {
    this.tokensInTotal += tokensIn(entry.usage);
    this.tokensOutTotal += entry.usage.output;
    const cost = usageCostUSD(entry.model, entry.usage);
    if (cost !== undefined) {
      this.costTotal += cost;
      this.hasCost = true;
    }
  }

  private remove(entry: Entry): void {
    this.tokensInTotal -= tokensIn(entry.usage);
    this.tokensOutTotal -= entry.usage.output;
    const cost = usageCostUSD(entry.model, entry.usage);
    if (cost !== undefined) this.costTotal -= cost;
  }

  snapshot(subagents: number): AgentStats {
    const hasCost = this.hasCost || this.baseline !== undefined;
    const base = this.baseline;
    return {
      toolCalls: this.toolCalls,
      tokensIn: this.tokensInTotal,
      tokensOut: this.tokensOutTotal,
      ...(hasCost ? { costUSD: Math.max(0, (base?.costUSD ?? 0) + this.costTotal) } : {}),
      linesAdded: (base?.linesAdded ?? 0) + this.linesAdded,
      linesRemoved: (base?.linesRemoved ?? 0) + this.linesRemoved,
      subagents,
    };
  }
}
