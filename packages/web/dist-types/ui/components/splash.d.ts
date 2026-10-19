import type { AppContext, Component } from '../context';
export declare class Splash implements Component {
    private readonly ctx;
    readonly el: HTMLDivElement;
    private readonly text;
    private readonly hint;
    private readonly startedAt;
    private hidden;
    constructor(ctx: AppContext);
    render(): void;
}
export declare class ConnectionBanner implements Component {
    private readonly ctx;
    readonly el: HTMLDivElement;
    private readonly text;
    private readonly countdown;
    constructor(ctx: AppContext);
    render(): void;
}
