import type { AppContext, Component } from '../context';
export declare class MessageHistory implements Component {
    private readonly ctx;
    private readonly nameOf;
    readonly el: HTMLDivElement;
    private readonly viewId;
    private agentIds;
    private signature;
    private watching;
    constructor(ctx: AppContext, nameOf: (agentId: string) => string);
    /** Starts (or stops, with an empty list) watching the messages of these agents. */
    setAgents(agentIds: readonly string[]): void;
    /** Only poll while the history is on screen. */
    setActive(active: boolean): void;
    refreshNow(): void;
    render(): void;
    private groupView;
}
