import type { Agent } from '@ai-office/shared';
import { type AppContext } from '../context';
export interface AgentTab {
    readonly el: HTMLElement;
    update(agent: Agent): void;
    setActive?(active: boolean): void;
}
export declare class SummaryTab implements AgentTab {
    private readonly ctx;
    readonly el: HTMLDivElement;
    private readonly tools;
    private readonly tokens;
    private readonly time;
    private readonly timeLive;
    private readonly cost;
    private readonly now;
    private readonly tasks;
    private readonly relations;
    private signatures;
    constructor(ctx: AppContext);
    update(agent: Agent): void;
    private renderNow;
    private renderTasks;
    private renderRelations;
    private miniRow;
}
export declare class MessagesTab implements AgentTab {
    private readonly ctx;
    readonly el: HTMLDivElement;
    private readonly composer;
    private readonly history;
    constructor(ctx: AppContext);
    update(agent: Agent): void;
    setActive(active: boolean): void;
}
export declare class ActivityTab implements AgentTab {
    private readonly ctx;
    readonly el: HTMLDivElement;
    private readonly shells;
    private readonly timeline;
    private readonly history;
    private loading;
    private failed;
    private agentId;
    private visibleCount;
    private signature;
    private shellSignature;
    private active;
    private readonly expanded;
    constructor(ctx: AppContext);
    setActive(active: boolean): void;
    update(agent: Agent): void;
    private load;
    private renderShells;
    private renderTimeline;
    private showMore;
    private timelineItem;
}
export declare class DataTab implements AgentTab {
    private readonly ctx;
    readonly el: HTMLDivElement;
    private readonly list;
    private readonly rows;
    private readonly duration;
    private readonly accountCell;
    private readonly sessionId;
    private agent;
    constructor(ctx: AppContext);
    private add;
    private row;
    private setValue;
    update(agent: Agent): void;
}
