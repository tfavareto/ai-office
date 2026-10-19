// "Needs you" marks coming from the Notification hook. Cleared by the agent's next transcript event.
const ATTENTION_TTL_MS = 30 * 60_000;
const DEFAULT_TEXT = 'Precisa de você';
const IDLE_PROMPT = /waiting for your input|aguardando.*(entrada|resposta|comando)/i;

interface Mark {
  at: number;
  message: string;
}

export interface AttentionInput {
  message?: string;
  notificationType?: string;
}

export class AttentionRegistry {
  private readonly marks = new Map<string, Mark>();

  constructor(
    private readonly now: () => number,
    private readonly onChange: () => void,
  ) {}

  /** Marks the agent. Idle-prompt notifications ("waiting for your input") are not "needs you": returns false. */
  mark(agentId: string, input: AttentionInput): boolean {
    if (input.notificationType === 'idle_prompt' || (input.message !== undefined && IDLE_PROMPT.test(input.message))) return false;
    this.marks.set(agentId, { at: this.now(), message: DEFAULT_TEXT });
    this.onChange();
    return true;
  }

  messageFor(agentId: string): string | undefined {
    const mark = this.marks.get(agentId);
    if (mark === undefined) return undefined;
    if (this.now() - mark.at > ATTENTION_TTL_MS) {
      this.marks.delete(agentId);
      return undefined;
    }
    return mark.message;
  }

  /** The agent produced a transcript event after the mark: the user (or a timeout) resolved it. */
  clearIfEventAfter(agentId: string, eventAt: number): void {
    const mark = this.marks.get(agentId);
    if (mark !== undefined && eventAt > mark.at) {
      this.marks.delete(agentId);
      this.onChange();
    }
  }
}
