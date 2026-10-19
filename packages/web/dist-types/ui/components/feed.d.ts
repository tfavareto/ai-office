import type { AppContext, Component } from '../context';
export declare class Feed implements Component {
    private readonly ctx;
    readonly el: HTMLElement;
    private readonly toggle;
    private readonly latest;
    private readonly count;
    private readonly chevron;
    private readonly list;
    private readonly empty;
    private readonly items;
    private lastId;
    private lastOpen;
    constructor(ctx: AppContext);
    render(): void;
    private createItem;
}
