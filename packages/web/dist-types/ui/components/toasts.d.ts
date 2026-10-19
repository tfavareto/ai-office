import type { AppContext, Component } from '../context';
export declare class Toasts implements Component {
    private readonly ctx;
    readonly el: HTMLDivElement;
    private readonly list;
    private signature;
    constructor(ctx: AppContext);
    render(): void;
    private create;
    private answer;
}
