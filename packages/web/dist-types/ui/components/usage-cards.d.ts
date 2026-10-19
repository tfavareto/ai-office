import type { AppContext, Component } from '../context';
export declare class UsageCards implements Component {
    private readonly ctx;
    readonly el: HTMLDivElement;
    private signature;
    constructor(ctx: AppContext);
    render(): void;
    private card;
    private line;
    private tooltip;
}
