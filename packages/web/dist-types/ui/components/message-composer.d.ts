import type { AppContext, Component } from '../context';
export interface ComposerTarget {
    /** Identifies the draft (agent or room id). */
    key: string;
    agentIds: readonly string[];
    /** Room name for team messages. */
    teamLabel?: string;
    placeholder: string;
    sendLabel: string;
    /** Why sending is not possible right now (shown instead of the form), or null. */
    blockedReason: string | null;
}
export declare class MessageComposer implements Component {
    private readonly ctx;
    private readonly onSent;
    readonly el: HTMLDivElement;
    private readonly textarea;
    private readonly sendBtn;
    private readonly sendLabel;
    private readonly chips;
    private readonly hint;
    private readonly error;
    private readonly blocked;
    private readonly form;
    private readonly drafts;
    private target;
    private sending;
    private lastFocusToken;
    constructor(ctx: AppContext, onSent?: () => void);
    private shortcutHint;
    setTarget(target: ComposerTarget): void;
    focus(): void;
    /** Honors "N" / "Mensagem" requests from elsewhere in the UI. */
    render(): void;
    private insertQuick;
    private updateSendState;
    private send;
    private showError;
}
