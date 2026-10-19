import type { AppContext, Component } from '../context';
export declare class Drawer implements Component {
    private readonly ctx;
    readonly el: HTMLElement;
    private readonly agentView;
    private readonly roomView;
    private shown;
    constructor(ctx: AppContext);
    render(): void;
}
