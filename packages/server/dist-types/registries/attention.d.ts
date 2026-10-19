export interface AttentionInput {
    message?: string;
    notificationType?: string;
}
export declare class AttentionRegistry {
    private readonly now;
    private readonly onChange;
    private readonly marks;
    constructor(now: () => number, onChange: () => void);
    /** Marks the agent. Idle-prompt notifications ("waiting for your input") are not "needs you": returns false. */
    mark(agentId: string, input: AttentionInput): boolean;
    messageFor(agentId: string): string | undefined;
    /** The agent produced a transcript event after the mark: the user (or a timeout) resolved it. */
    clearIfEventAfter(agentId: string, eventAt: number): void;
}
